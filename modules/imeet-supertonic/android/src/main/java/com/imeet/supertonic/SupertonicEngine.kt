package com.imeet.supertonic

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Debug
import android.os.SystemClock
import android.util.Log
import com.k2fsa.sherpa.onnx.GenerationConfig
import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsSupertonicModelConfig
import java.io.File
import java.util.concurrent.CancellationException

internal class SupertonicOperation {
  val requestedAt = SystemClock.elapsedRealtime()
  @Volatile var cancelled = false
    private set
  private var player: AudioTrack? = null

  fun check() {
    if (cancelled) throw CancellationException("Supertonic operation cancelled")
  }

  @Synchronized fun start(track: AudioTrack): Boolean {
    if (cancelled) return false
    track.play()
    player = track
    return true
  }

  @Synchronized fun cancel() {
    cancelled = true
    player?.let { runCatching { it.pause() } }
  }

  @Synchronized fun release(track: AudioTrack) {
    if (player === track) player = null
    track.release()
  }
}

internal class SupertonicEngine {
  private var engine: OfflineTts? = null
  private var dictionary: SupertonicAccentDictionary? = null
  private var baselinePssKb = 0

  fun enableDictionary(baseDir: File, operation: SupertonicOperation, progress: (Long, Long) -> Unit) {
    if (dictionary != null) return
    val file = SupertonicAccentDictionary.ensure(baseDir, operation, progress)
    operation.check()
    dictionary = SupertonicAccentDictionary.open(file)
    Log.i(TAG, "Russian accent dictionary enabled; pssKb=${pssKb()}")
  }

  fun disableDictionary() {
    dictionary?.close()
    dictionary = null
  }

  fun isDictionaryEnabled() = dictionary != null

  fun prefetchModel(baseDir: File, operation: SupertonicOperation, progress: (Long, Long) -> Unit) {
    SupertonicModel.ensure(baseDir, operation, progress)
  }

  fun initialize(baseDir: File, operation: SupertonicOperation, progress: (Long, Long) -> Unit) {
    if (engine != null) return
    val cacheStarted = SystemClock.elapsedRealtime()
    val directory = SupertonicModel.ensure(baseDir, operation, progress)
    val cacheMs = SystemClock.elapsedRealtime() - cacheStarted
    operation.check()

    val config = OfflineTtsConfig(
      model = OfflineTtsModelConfig(
        numThreads = 2,
        supertonic = OfflineTtsSupertonicModelConfig(
          durationPredictor = File(directory, "duration_predictor.int8.onnx").path,
          textEncoder = File(directory, "text_encoder.int8.onnx").path,
          vectorEstimator = File(directory, "vector_estimator.int8.onnx").path,
          vocoder = File(directory, "vocoder.int8.onnx").path,
          ttsJson = File(directory, "tts.json").path,
          unicodeIndexer = File(directory, "unicode_indexer.bin").path,
          voiceStyle = File(directory, "voice.bin").path,
        ),
      ),
    )
    baselinePssKb = pssKb()
    val initStarted = SystemClock.elapsedRealtime()
    val instance = OfflineTts(config = config)
    val initMs = SystemClock.elapsedRealtime() - initStarted
    if (operation.cancelled) {
      instance.release()
      operation.check()
    }
    engine = instance
    val initPssKb = pssKb()
    Log.i(TAG, "voice=F1 cacheMs=$cacheMs initMs=$initMs pssBeforeKb=$baselinePssKb " +
      "pssAfterInitKb=$initPssKb initPssDeltaKb=${initPssKb - baselinePssKb}")
  }

  fun play(
    text: String,
    speed: Float,
    voiceId: Int,
    operation: SupertonicOperation,
    onMetrics: (Long, Long, Long, Int) -> Unit,
  ): String {
    if (operation.cancelled) return "stopped"
    require(text.isNotBlank() && text.length <= 500) { "Supertonic: ожидается короткая фраза" }
    require(speed in 0.5f..2f) { "Supertonic: недопустимая скорость" }
    require(voiceId in 0..9) { "Supertonic: неизвестный голос" }
    val instance = checkNotNull(engine) { "Supertonic не инициализирован" }
    val dictionaryStarted = SystemClock.elapsedRealtime()
    val prepared = dictionary?.apply(text)
    val preparedText = prepared?.text ?: text
    val dictionaryMs = SystemClock.elapsedRealtime() - dictionaryStarted
    operation.check()
    val synthesisStarted = SystemClock.elapsedRealtime()
    // v1.13.5 looks up a concrete Kotlin callback signature that is not stable across compilers.
    // Discard a cancelled inference before creating an AudioTrack.
    val audio = instance.generateWithConfig(
      preparedText,
      GenerationConfig(sid = voiceId, speed = speed, numSteps = 8, extra = mapOf("lang" to "ru")),
    )
    val synthesisMs = SystemClock.elapsedRealtime() - synthesisStarted
    if (operation.cancelled) return "stopped"
    check(audio.samples.isNotEmpty() && audio.sampleRate > 0) { "Supertonic вернул пустое аудио" }

    val track = AudioTrack.Builder()
      .setAudioAttributes(AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build())
      .setAudioFormat(AudioFormat.Builder()
        .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
        .setSampleRate(audio.sampleRate)
        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
        .build())
      .setTransferMode(AudioTrack.MODE_STATIC)
      .setBufferSizeInBytes(audio.samples.size * Float.SIZE_BYTES)
      .build()
    try {
      val written = track.write(audio.samples, 0, audio.samples.size, AudioTrack.WRITE_BLOCKING)
      check(written == audio.samples.size && track.state == AudioTrack.STATE_INITIALIZED) {
        "Не удалось подготовить воспроизведение Supertonic"
      }
      if (!operation.start(track)) return "stopped"

      val audioMs = audio.samples.size * 1000L / audio.sampleRate
      val deadline = SystemClock.elapsedRealtime() + audioMs + 8_000L
      var firstFrame = false
      while (!operation.cancelled) {
        val position = track.playbackHeadPosition
        if (!firstFrame && position > 0) {
          firstFrame = true
          val firstFrameMs = SystemClock.elapsedRealtime() - operation.requestedAt
          val firstFrameEpochMs = System.currentTimeMillis()
          val playbackPssKb = pssKb()
          onMetrics(synthesisMs, firstFrameMs, dictionaryMs, prepared?.replacements ?: 0)
          val voiceName = if (voiceId < 5) "F${voiceId + 1}" else "M${voiceId - 4}"
          Log.i(TAG, "voice=$voiceName dictionaryMs=$dictionaryMs stressReplacements=${prepared?.replacements ?: 0} " +
            "synthesisMs=$synthesisMs firstFrameMs=$firstFrameMs audioMs=$audioMs " +
            "firstFrameEpochMs=$firstFrameEpochMs " +
            "pssWithAudioKb=$playbackPssKb playbackPssDeltaKb=${playbackPssKb - baselinePssKb}")
        }
        if (position >= audio.samples.size) return "completed"
        check(SystemClock.elapsedRealtime() < deadline) { "Воспроизведение Supertonic прервалось" }
        Thread.sleep(10)
      }
      return "stopped"
    } finally {
      operation.release(track)
    }
  }

  fun release() {
    engine?.release()
    engine = null
    disableDictionary()
  }

  private fun pssKb() = Debug.MemoryInfo().also(Debug::getMemoryInfo).totalPss

  private companion object {
    const val TAG = "IMeetSupertonic"
  }
}
