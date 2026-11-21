package com.imeet.voice

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.SystemClock
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.min

/** Встроенный голос Silero (ONNX в APK): загрузка, синтез и воспроизведение через AudioTrack. */
class IMeetSileroModule : Module() {
  private val worker = Executors.newSingleThreadExecutor()
  @Volatile private var engine: SileroEngine? = null
  @Volatile private var loadMs = 0L
  @Volatile private var track: AudioTrack? = null
  @Volatile private var generation = 0

  override fun definition() = ModuleDefinition {
    Name("IMeetSilero")
    Events("onSileroStart")

    AsyncFunction("status") {
      val context = appContext.reactContext
      mapOf(
        "bundled" to (context != null && SileroEngine.assetsPresent(context)),
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
          promise.reject("ERR_SILERO_LOAD", t.message ?: t.toString(), t)
        }
      }
    }

    AsyncFunction("speak") { text: String, speaker: String, requestId: Int, promise: Promise ->
      val gen = ++generation
      stopTrack()
      val requestedAt = SystemClock.elapsedRealtime()
      worker.execute {
        try {
          if (gen != generation) { promise.resolve("stopped"); return@execute }
          val e = ensureEngine()
          val result = e.synthesize(text, speaker)
          if (gen != generation) { promise.resolve("stopped"); return@execute }
          val finished = play(result.audio, e.sampleRate, gen) {
            sendEvent("onSileroStart", mapOf(
              "requestId" to requestId,
              "firstFrameMs" to (SystemClock.elapsedRealtime() - requestedAt),
              "synthMs" to result.synthMs,
              "audioMs" to (result.audio.size * 1000L / e.sampleRate),
              "accented" to result.accented,
            ))
          }
          promise.resolve(if (finished && gen == generation) "completed" else "stopped")
        } catch (t: Throwable) {
          promise.reject("ERR_SILERO_SPEAK", t.message ?: t.toString(), t)
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
      worker.shutdown()
    }
  }

  private fun ensureEngine(): SileroEngine {
    engine?.let { return it }
    val context = checkNotNull(appContext.reactContext) { "Нет контекста приложения" }
    check(SileroEngine.assetsPresent(context)) { "Модели Silero не вложены в эту сборку APK" }
    val started = SystemClock.elapsedRealtime()
    val loaded = SileroEngine.load(context)
    loadMs = SystemClock.elapsedRealtime() - started
    engine = loaded
    return loaded
  }

  /** Играет звук целиком; false — если остановили. */
  private fun play(audio: FloatArray, rate: Int, gen: Int, onStart: () -> Unit): Boolean {
    val minBuffer = AudioTrack.getMinBufferSize(rate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_FLOAT)
    val output = AudioTrack.Builder()
      .setAudioAttributes(AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA)
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
    try {
      output.play()
      onStart()
      var offset = 0
      while (offset < audio.size && gen == generation) {
        val written = output.write(audio, offset, min(4096, audio.size - offset), AudioTrack.WRITE_BLOCKING)
        if (written <= 0) break
        offset += written
      }
      val deadline = SystemClock.elapsedRealtime() + audio.size * 1000L / rate + 2000
      while (gen == generation && output.playbackHeadPosition < offset && SystemClock.elapsedRealtime() < deadline) {
        Thread.sleep(15)
      }
      return gen == generation
    } finally {
      runCatching { output.stop() }
      output.release()
      if (track === output) track = null
    }
  }

  private fun stopTrack() {
    track?.let { runCatching { it.pause(); it.flush(); it.stop() } }   // stop() отпускает блокирующий write
  }
}
