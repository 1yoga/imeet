package com.imeet.voice

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Build
import android.os.SystemClock
import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.Callable
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.min

/** Встроенный голос Silero (ONNX в APK): загрузка, синтез и воспроизведение через AudioTrack. */
class IMeetSileroModule : Module() {
  private val worker = Executors.newSingleThreadExecutor()
  private val synth = Executors.newSingleThreadExecutor()
  @Volatile private var engine: SileroEngine? = null
  @Volatile private var loadMs = 0L
  @Volatile private var track: AudioTrack? = null
  @Volatile private var generation = 0
  @Volatile private var stream: Stream? = null
  /** Играть как голосовой вызов: эхоподавление микрофона получает звук агента как опорный сигнал. */
  @Volatile private var communication = false

  /** Потоковая реплика: текст приходит порциями (например, от LLM), звук идёт, не дожидаясь конца. */
  private class Stream(
    val requestId: Int, val gen: Int, val speaker: String,
    val options: SileroEngine.Options, val pauseMap: Map<String, Int>, val startedAt: Long,
  ) {
    val texts = LinkedBlockingQueue<String>()
    @Volatile var firstTextAt = 0L
    var finishPromise: Promise? = null
    var result: String? = null
  }

  override fun definition() = ModuleDefinition {
    Name("IMeetSilero")
    Events("onSileroStart", "onSileroDone", "onSileroDownload", "onSileroLevel")

    // Модели голоса не в APK: скачиваются при первом запуске (VoiceModelStore), прогресс — событием.
    AsyncFunction("download") { promise: Promise ->
      worker.execute {
        try {
          val context = checkNotNull(appContext.reactContext) { "Нет контекста приложения" }
          VoiceModelStore.ensure(context) { fraction, message ->
            sendEvent("onSileroDownload", mapOf("fraction" to fraction, "message" to message))
          }
          promise.resolve(null)
        } catch (t: Throwable) {
          Log.e(TAG, "download failed", t)
          promise.reject("ERR_SILERO_DOWNLOAD", describe(t), t)
        }
      }
    }

    // Потоковая озвучка: streamStart → streamAppend (сколько угодно раз) → streamFinish (ждёт конца звука).
    AsyncFunction("streamStart") { requestId: Int, speaker: String, options: Map<String, Any?> ->
      val gen = ++generation
      stopTrack()
      setCommunication(options["communication"] as? Boolean ?: false)
      @Suppress("UNCHECKED_CAST")
      val pauseMap = (options["pauses"] as? Map<String, Any?>).orEmpty().mapValues { (it.value as? Number)?.toInt() ?: 0 }
      val synthOptions = SileroEngine.Options(
        rules = options["rules"] as? Boolean ?: true,
        pitch = ((options["pitch"] as? Number)?.toDouble() ?: 1.0).toFloat(),
      )
      val s = Stream(requestId, gen, speaker, synthOptions, pauseMap, SystemClock.elapsedRealtime())
      stream = s
      worker.execute { runStream(s) }
    }

    AsyncFunction("streamAppend") { requestId: Int, text: String ->
      val s = stream
      if (s != null && s.requestId == requestId && text.isNotBlank()) {
        if (s.firstTextAt == 0L) s.firstTextAt = SystemClock.elapsedRealtime()
        s.texts.put(text)
      }
    }

    AsyncFunction("streamFinish") { requestId: Int, promise: Promise ->
      val s = stream
      if (s == null || s.requestId != requestId) {
        promise.resolve("stopped")
      } else {
        synchronized(s) {
          val done = s.result
          if (done != null) promise.resolve(done) else s.finishPromise = promise
        }
        s.texts.put(END)
      }
    }

    AsyncFunction("status") {
      val context = appContext.reactContext
      mapOf(
        "bundled" to (context != null && SileroEngine.modelsReady(context)),
        "loaded" to (engine != null),
        "loadMs" to loadMs,
      )
    }

    AsyncFunction("load") { promise: Promise ->
      worker.execute {
        try {
          val e = ensureEngine()
          promise.resolve(mapOf("loadMs" to loadMs, "speakers" to e.speakerNames))
        } catch (t: Throwable) {
          Log.e(TAG, "load failed", t)
          promise.reject("ERR_SILERO_LOAD", describe(t), t)
        }
      }
    }

    // options: mode 0 — целиком, 1 — по предложениям, 2 — по фразам (+ запятые и тире, как RuVoice);
    //   pauses {sentence, comma, dash, paragraph} — добавочная тишина после куска, мс;
    //   pitch — высота (1 — как модель); rules — словари чтения RuVoice; recordName — сохранить звук в files/compare.
    // Куски синтезируются по очереди: первый звучит, пока готовятся следующие.
    AsyncFunction("speak") { text: String, speaker: String, requestId: Int, options: Map<String, Any?>, promise: Promise ->
      fun num(key: String, default: Double) = (options[key] as? Number)?.toDouble() ?: default
      val mode = num("mode", 0.0).toInt()
      val chunked = mode > 0
      val recordName = options["recordName"] as? String ?: ""
      val synthOptions = SileroEngine.Options(rules = options["rules"] as? Boolean ?: true, pitch = num("pitch", 1.0).toFloat())
      @Suppress("UNCHECKED_CAST")
      val pauseMap = (options["pauses"] as? Map<String, Any?>).orEmpty().mapValues { (it.value as? Number)?.toInt() ?: 0 }
      val gen = ++generation
      stopTrack()
      setCommunication(options["communication"] as? Boolean ?: false)
      val requestedAt = SystemClock.elapsedRealtime()
      worker.execute {
        val futures = ArrayList<Future<SileroEngine.Result?>>()
        val sampler = VoiceMetricsLog.PeakSampler()
        var firstFrameMs = -1L
        val results = ArrayList<SileroEngine.Result>()
        val stats = PlayStats()
        fun record(state: String, error: String? = null) {
          val peak = sampler.stop()
          val context = appContext.reactContext ?: return
          val audioMs = results.sumOf { it.audio.size.toLong() } * 1000L / 48000
          val synthMs = results.sumOf { it.synthMs }
          VoiceMetricsLog.append(context, "silero_speak", JSONObject().apply {
            put("requestId", requestId); put("speaker", speaker); put("chunked", chunked); put("mode", mode); put("state", state)
            put("pauses", JSONObject(pauseMap)); put("pitch", synthOptions.pitch.toDouble()); put("rules", synthOptions.rules)
            if (recordName.isNotEmpty()) put("recordName", recordName)
            put("text", text); put("textChars", text.length)
            put("firstFrameMs", firstFrameMs)
            put("chunks", results.size)
            put("chunkSynthMs", JSONArray(results.map { it.synthMs }))
            put("chunkAudioMs", JSONArray(results.map { it.audio.size * 1000L / 48000 }))
            put("synthMs", synthMs); put("audioMs", audioMs)
            put("rtf", if (audioMs > 0) synthMs.toDouble() / audioMs else JSONObject.NULL)
            put("gapMs", stats.gapMs)
            put("focusSymbols", results.sumOf { it.focusSymbols })
            put("homographs", engine?.homographs ?: false)
            put("accented", results.joinToString(" ") { it.accented })
            put("types", results.joinToString("|") { it.types })
            put("peakNativeHeapKb", peak)
            put("memoryAfter", VoiceMetricsLog.memory())
            if (error != null) put("error", error)
          })
        }
        try {
          if (gen != generation) { sampler.stop(); promise.resolve("stopped"); return@execute }
          val e = ensureEngine()
          val source = if (chunked) e.prepareForChunks(text, synthOptions) else text
          val pieceOptions = if (chunked) synthOptions.copy(rules = false) else synthOptions
          val pieces = (if (chunked) SileroEngine.split(source, byPhrases = mode == 2) else emptyList())
            .ifEmpty { listOf(text to SileroEngine.Boundary.END) }
          val parts = pieces.map { it.first }
          // Тишина после каждого куска (кроме последнего) по типу границы.
          val pauses = pieces.map { (_, kind) ->
            val ms = when (kind) {
              SileroEngine.Boundary.SENTENCE -> pauseMap["sentence"]
              SileroEngine.Boundary.COMMA -> pauseMap["comma"]
              SileroEngine.Boundary.DASH -> pauseMap["dash"]
              SileroEngine.Boundary.PARAGRAPH -> pauseMap["paragraph"]
              SileroEngine.Boundary.END -> 0
            } ?: 0
            FloatArray(e.sampleRate * ms.coerceIn(0, 2000) / 1000)
          }
          parts.forEach { part -> futures.add(synth.submit(Callable<SileroEngine.Result?> { if (gen != generation) null else e.synthesize(part, speaker, pieceOptions) })) }
          val finished = play(e.sampleRate, gen, parts.size, stats, pauses, next = { i ->
            if (gen != generation) null else futures[i].get()?.also { results.add(it) }
          }) {
            val first = results.first()
            firstFrameMs = SystemClock.elapsedRealtime() - requestedAt
            sendEvent("onSileroStart", mapOf(
              "requestId" to requestId,
              "firstFrameMs" to firstFrameMs,
              "synthMs" to first.synthMs,
              "audioMs" to (first.audio.size * 1000L / e.sampleRate),
              "accented" to first.accented,
              "types" to first.types,
            ))
          }
          if (results.isNotEmpty()) {
            val synthMs = results.sumOf { it.synthMs }
            val audioMs = results.sumOf { it.audio.size.toLong() } * 1000L / e.sampleRate
            val accented = results.joinToString(" ") { it.accented }
            val types = results.joinToString("|") { it.types }
            val focus = results.sumOf { it.focusSymbols }
            Log.i(TAG, "synth ${synthMs} ms for ${audioMs} ms audio, chunks=${results.size}, firstChunk=${results.first().synthMs} ms, " +
              "gaps=${stats.gapMs} ms, focusSymbols=$focus, homographs=${e.homographs}, types=$types, accented=$accented")
            sendEvent("onSileroDone", mapOf(
              "requestId" to requestId, "synthMs" to synthMs, "audioMs" to audioMs, "accented" to accented, "types" to types,
              "chunks" to results.size, "gapMs" to stats.gapMs, "focusSymbols" to focus, "homographs" to e.homographs,
            ))
          }
          val state = if (finished && gen == generation) "completed" else "stopped"
          if (state == "completed" && recordName.isNotEmpty()) runCatching {
            val gaps = (0 until results.size - 1).sumOf { pauses[it].size }
            val all = FloatArray(results.sumOf { it.audio.size } + gaps)
            var pos = 0
            results.forEachIndexed { i, res ->
              if (i > 0) { val p = pauses[i - 1]; System.arraycopy(p, 0, all, pos, p.size); pos += p.size }
              System.arraycopy(res.audio, 0, all, pos, res.audio.size); pos += res.audio.size
            }
            WavFile.writeFloat(WavFile.compareFile(checkNotNull(appContext.reactContext), recordName), all, e.sampleRate)
          }.onFailure { Log.e(TAG, "record failed", it) }
          record(state)
          promise.resolve(state)
        } catch (t: Throwable) {
          futures.forEach { it.cancel(false) }
          if (gen != generation) { record("stopped"); promise.resolve("stopped"); return@execute }
          record("error", describe(t))
          Log.e(TAG, "speak failed", t)
          promise.reject("ERR_SILERO_SPEAK", describe(t), t)
        }
      }
    }

    AsyncFunction("stop") {
      generation++
      stopTrack()
    }

    OnDestroy {
      generation++
      stopTrack()
      setCommunication(false)
      worker.shutdown()
      synth.shutdown()
    }
  }

  private fun ensureEngine(): SileroEngine {
    engine?.let { return it }
    val context = checkNotNull(appContext.reactContext) { "Нет контекста приложения" }
    check(SileroEngine.modelsReady(context)) { "Модели голоса ещё не скачаны" }
    val before = VoiceMetricsLog.memory()
    val sampler = VoiceMetricsLog.PeakSampler()
    val started = SystemClock.elapsedRealtime()
    val loaded = try {
      SileroEngine.load(context)
    } catch (t: Throwable) {
      sampler.stop()
      VoiceMetricsLog.append(context, "silero_load", JSONObject().put("state", "error").put("error", describe(t)))
      throw t
    }
    // Прогрев: первый синтез после загрузки заметно медленнее (выделение памяти, правила) — делаем его заранее.
    runCatching { loaded.synthesize("Привет! Как дела, что нового?", loaded.speakerNames.first()) }
    loadMs = SystemClock.elapsedRealtime() - started
    VoiceMetricsLog.append(context, "silero_load", JSONObject().apply {
      put("state", "ok"); put("loadMs", loadMs); put("homographs", loaded.homographs); put("rules", loaded.rulesInfo)
      put("peakNativeHeapKb", sampler.stop())
      put("memoryBefore", before); put("memoryAfter", VoiceMetricsLog.memory())
    })
    engine = loaded
    return loaded
  }

  private class PlayStats { var gapMs = 0L }

  /**
   * Играет куски по очереди в одну дорожку AudioTrack; next(i) ждёт, пока кусок i синтезирован.
   * gapMs — сколько тишины вышло из-за того, что следующий кусок не успел. false — если остановили.
   */
  private fun play(rate: Int, gen: Int, count: Int, stats: PlayStats, pauses: List<FloatArray>, next: (Int) -> SileroEngine.Result?, onStart: () -> Unit): Boolean {
    val firstChunk = next(0) ?: return false
    val minBuffer = AudioTrack.getMinBufferSize(rate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_FLOAT)
    val output = AudioTrack.Builder()
      .setAudioAttributes(AudioAttributes.Builder()
        .setUsage(outputUsage())
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build())
      .setAudioFormat(AudioFormat.Builder()
        .setSampleRate(rate)
        .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
        .build())
      .setTransferMode(AudioTrack.MODE_STREAM)
      .setBufferSizeInBytes(max(minBuffer, rate / 5 * 4))
      .build()
    track = output
    val meter = LevelMeter(output, rate, ::sendLevel)
    try {
      output.play()
      onStart()
      var written = 0L
      var chunk: SileroEngine.Result? = firstChunk
      var index = 0
      while (chunk != null && gen == generation) {
        val audio = chunk.audio
        meter.add(written, audio)
        var offset = 0
        while (offset < audio.size && gen == generation) {
          val n = output.write(audio, offset, min(4096, audio.size - offset), AudioTrack.WRITE_BLOCKING)
          if (n <= 0) break
          offset += n
        }
        written += offset
        index++
        if (index >= count) break
        val pause = pauses[index - 1]
        if (pause.isNotEmpty() && gen == generation) {
          written += maxOf(0, output.write(pause, 0, pause.size, AudioTrack.WRITE_BLOCKING))
        }
        val buffered = written - output.playbackHeadPosition.toLong()       // ещё не проиграно, в кадрах
        val waitStart = SystemClock.elapsedRealtime()
        chunk = next(index)
        val waited = SystemClock.elapsedRealtime() - waitStart
        stats.gapMs += max(0L, waited - buffered * 1000L / rate)
      }
      val deadline = SystemClock.elapsedRealtime() + written * 1000L / rate + 2000
      while (gen == generation && output.playbackHeadPosition < written && SystemClock.elapsedRealtime() < deadline) {
        Thread.sleep(15)
      }
      return gen == generation
    } finally {
      meter.stop()
      runCatching { output.stop() }
      output.release()
      if (track === output) track = null
    }
  }

  private fun sendLevel(level: Double, bands: List<Double>) {
    sendEvent("onSileroLevel", mapOf("level" to level, "bands" to bands))
  }

  /** Синтез идёт в своём потоке по мере прихода текста, воспроизведение — здесь, одной дорожкой. */
  private fun runStream(s: Stream) {
    val context = appContext.reactContext
    val sampler = VoiceMetricsLog.PeakSampler()
    val results = ArrayList<SileroEngine.Result>()
    val audio = LinkedBlockingQueue<Pair<FloatArray, Int>>()   // звук куска и пауза после него, мс
    val producerDone = java.util.concurrent.atomic.AtomicBoolean(false)
    val producerBusy = java.util.concurrent.atomic.AtomicBoolean(false)
    val producerError = java.util.concurrent.atomic.AtomicReference<Throwable?>(null)
    var output: AudioTrack? = null
    var meter: LevelMeter? = null
    var written = 0L
    var firstFrameMs = -1L
    var sinceTextMs = -1L
    var waitSynthMs = 0L
    var waitTextMs = 0L
    var state = "completed"
    var error: String? = null
    try {
      val e = ensureEngine()
      val rate = e.sampleRate
      synth.execute {
        try {
          while (s.gen == generation) {
            val text = s.texts.poll(30, TimeUnit.MILLISECONDS) ?: continue
            if (text == END) break
            producerBusy.set(true)
            val pieces = SileroEngine.split(e.prepareForChunks(text, s.options), byPhrases = true)
            for ((piece, kind) in pieces) {
              if (s.gen != generation) break
              val r = e.synthesize(piece, s.speaker, s.options.copy(rules = false))
              synchronized(results) { results.add(r) }
              val pauseMs = when (kind) {
                SileroEngine.Boundary.COMMA -> s.pauseMap["comma"]
                SileroEngine.Boundary.DASH -> s.pauseMap["dash"]
                SileroEngine.Boundary.PARAGRAPH -> s.pauseMap["paragraph"]
                else -> s.pauseMap["sentence"]
              } ?: 0
              audio.put(r.audio to pauseMs)
            }
            producerBusy.set(false)
          }
        } catch (t: Throwable) {
          producerError.set(t)
        } finally {
          producerBusy.set(false)
          producerDone.set(true)
        }
      }
      while (s.gen == generation) {
        val item = audio.poll(20, TimeUnit.MILLISECONDS)
        if (item == null) {
          if (producerDone.get() && audio.isEmpty()) break
          val track = output
          // Звук кончился, а следующего куска нет: пауза из-за синтеза или из-за того, что текст ещё не пришёл.
          if (track != null && track.playbackHeadPosition.toLong() >= written) {
            if (producerBusy.get()) waitSynthMs += 20 else waitTextMs += 20
          }
          continue
        }
        if (output == null) {
          output = newTrack(rate)
          track = output
          meter = LevelMeter(output, rate, ::sendLevel)
          output.play()
          val now = SystemClock.elapsedRealtime()
          firstFrameMs = now - s.startedAt
          sinceTextMs = if (s.firstTextAt > 0) now - s.firstTextAt else -1
          val first = synchronized(results) { results.first() }
          sendEvent("onSileroStart", mapOf(
            "requestId" to s.requestId, "firstFrameMs" to firstFrameMs, "sinceTextMs" to sinceTextMs,
            "synthMs" to first.synthMs, "audioMs" to (first.audio.size * 1000L / rate),
            "accented" to first.accented, "types" to first.types,
          ))
        }
        val (pcm, pauseMs) = item
        meter?.add(written, pcm)
        var offset = 0
        while (offset < pcm.size && s.gen == generation) {
          val n = output.write(pcm, offset, min(4096, pcm.size - offset), AudioTrack.WRITE_BLOCKING)
          if (n <= 0) break
          offset += n
        }
        written += offset
        if (pauseMs > 0 && s.gen == generation) {
          val silence = FloatArray(rate * pauseMs.coerceIn(0, 2000) / 1000)
          written += maxOf(0, output.write(silence, 0, silence.size, AudioTrack.WRITE_BLOCKING))
        }
      }
      producerError.get()?.let { throw it }
      val deadline = SystemClock.elapsedRealtime() + written * 1000L / rate + 2000
      while (s.gen == generation && output != null && output.playbackHeadPosition < written && SystemClock.elapsedRealtime() < deadline) {
        Thread.sleep(15)
      }
      if (s.gen != generation) state = "stopped"
    } catch (t: Throwable) {
      if (s.gen != generation) state = "stopped" else { state = "error"; error = describe(t); Log.e(TAG, "stream failed", t) }
    } finally {
      meter?.stop()
      output?.let { runCatching { it.stop() }; it.release(); if (track === it) track = null }
    }
    val rate = 48000
    val done = synchronized(results) { results.toList() }
    val synthMs = done.sumOf { it.synthMs }
    val audioMs = done.sumOf { it.audio.size.toLong() } * 1000L / rate
    val accented = done.joinToString(" ") { it.accented }
    Log.i(TAG, "stream: first ${firstFrameMs} ms (after text ${sinceTextMs} ms), synth ${synthMs} ms for ${audioMs} ms, " +
      "chunks=${done.size}, waitSynth=${waitSynthMs} ms, waitText=${waitTextMs} ms, state=$state, accented=$accented")
    if (state != "error") {
      sendEvent("onSileroDone", mapOf(
        "requestId" to s.requestId, "synthMs" to synthMs, "audioMs" to audioMs, "accented" to accented,
        "types" to done.joinToString("|") { it.types }, "chunks" to done.size, "gapMs" to waitSynthMs,
        "focusSymbols" to done.sumOf { it.focusSymbols }, "homographs" to (engine?.homographs ?: false),
      ))
    }
    if (context != null) {
      VoiceMetricsLog.append(context, "silero_stream", JSONObject().apply {
        put("requestId", s.requestId); put("speaker", s.speaker); put("state", state)
        put("firstFrameMs", firstFrameMs); put("sinceTextMs", sinceTextMs)
        put("chunks", done.size); put("chunkSynthMs", JSONArray(done.map { it.synthMs }))
        put("synthMs", synthMs); put("audioMs", audioMs)
        put("rtf", if (audioMs > 0) synthMs.toDouble() / audioMs else JSONObject.NULL)
        put("waitSynthMs", waitSynthMs); put("waitTextMs", waitTextMs)
        put("pitch", s.options.pitch.toDouble()); put("rules", s.options.rules); put("pauses", JSONObject(s.pauseMap))
        put("accented", accented); put("peakNativeHeapKb", sampler.stop()); put("memoryAfter", VoiceMetricsLog.memory())
        if (error != null) put("error", error)
      })
    } else {
      sampler.stop()
    }
    synchronized(s) {
      s.result = if (state == "error") "error" else state
      s.finishPromise?.let { p ->
        if (state == "error") p.reject("ERR_SILERO_STREAM", error ?: "stream failed", null) else p.resolve(state)
      }
      s.finishPromise = null
    }
    if (stream === s) stream = null
  }

  private fun newTrack(rate: Int): AudioTrack {
    val minBuffer = AudioTrack.getMinBufferSize(rate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_FLOAT)
    return AudioTrack.Builder()
      .setAudioAttributes(AudioAttributes.Builder()
        .setUsage(outputUsage())
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build())
      .setAudioFormat(AudioFormat.Builder()
        .setSampleRate(rate)
        .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
        .build())
      .setTransferMode(AudioTrack.MODE_STREAM)
      .setBufferSizeInBytes(max(minBuffer, rate / 5 * 4))
      .build()
  }

  private fun outputUsage() =
    if (communication) AudioAttributes.USAGE_VOICE_COMMUNICATION else AudioAttributes.USAGE_MEDIA

  /**
   * Включает или выключает режим «голосового вызова» для озвучки. Такой звук по умолчанию идёт в разговорный динамик,
   * поэтому, если не подключены наушники, направляем его на громкий. Выключение возвращает маршрут системе.
   */
  private fun setCommunication(on: Boolean) {
    val changed = communication != on
    communication = on
    if (!changed) return
    try {
      val context = appContext.reactContext ?: return
      val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      val headset = audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any {
        it.type == AudioDeviceInfo.TYPE_WIRED_HEADSET || it.type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
          it.type == AudioDeviceInfo.TYPE_USB_HEADSET || it.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP ||
          it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        if (on && !headset) {
          audio.availableCommunicationDevices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
            ?.let { audio.setCommunicationDevice(it) }
        } else {
          audio.clearCommunicationDevice()
        }
      } else {
        @Suppress("DEPRECATION")
        audio.isSpeakerphoneOn = on && !headset
      }
    } catch (t: Throwable) {
      Log.w(TAG, "communication route failed", t)
    }
  }

  /** Вся цепочка причин: «ExceptionInInitializerError» сам по себе ничего не говорит. */
  private fun describe(t: Throwable): String =
    generateSequence(t) { it.cause }.take(4).joinToString(" ← ") { "${it.javaClass.simpleName}: ${it.message ?: ""}" }

  private companion object {
    const val TAG = "IMeetSilero"
    const val END = "\u0000end"
  }

  private fun stopTrack() {
    track?.let { runCatching { it.pause(); it.flush(); it.stop() } }   // stop() отпускает блокирующий write
  }
}
