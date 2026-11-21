package com.imeet.voice

import android.media.audiofx.Visualizer
import android.os.SystemClock
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlin.math.hypot
import kotlin.math.log10
import kotlin.math.sqrt

/**
 * Громкость и тембр того, что сейчас звучит из динамика (голос агента из RuVoice играет
 * в другом процессе). Android Visualizer на общем выходе (сессия 0): спектр раз в ~50 мс →
 * уровень 0..1 и пять полос речи от низких к высоким.
 */
class IMeetOutputLevelModule : Module() {
  private var visualizer: Visualizer? = null
  private var lastSentAt = 0L

  override fun definition() = ModuleDefinition {
    Name("IMeetOutputLevel")
    Events("onOutputLevel")

    Function("start") {
      if (visualizer != null) return@Function true
      try {
        val v = Visualizer(0)
        v.setEnabled(false)
        v.setCaptureSize(Visualizer.getCaptureSizeRange()[1].coerceAtMost(1024))
        val rate = Visualizer.getMaxCaptureRate().coerceAtMost(20_000)
        v.setDataCaptureListener(object : Visualizer.OnDataCaptureListener {
          override fun onWaveFormDataCapture(vis: Visualizer?, waveform: ByteArray?, samplingRate: Int) = Unit
          override fun onFftDataCapture(vis: Visualizer?, fft: ByteArray?, samplingRate: Int) {
            if (fft != null) report(fft, samplingRate)
          }
        }, rate, false, true)
        v.setEnabled(true)
        visualizer = v
        true
      } catch (error: Throwable) {
        // Нет доступа к общему выходу на этом устройстве: волна агента вернётся к ритму без звука.
        visualizer = null
        false
      }
    }

    Function("stop") {
      release()
    }

    OnDestroy {
      release()
    }
  }

  private fun release() {
    visualizer?.let {
      runCatching { it.setEnabled(false) }
      runCatching { it.release() }
    }
    visualizer = null
  }

  private fun report(fft: ByteArray, samplingRateMilliHz: Int) {
    val now = SystemClock.elapsedRealtime()
    if (now - lastSentAt < 40) return
    lastSentAt = now

    val n = fft.size
    val hzPerBin = samplingRateMilliHz / 1000.0 / n
    val sums = DoubleArray(BAND_EDGES.size - 1)
    val counts = IntArray(BAND_EDGES.size - 1)
    var energy = 0.0
    var speechBins = 0
    var k = 1
    while (k < n / 2) {
      val magnitude = hypot(fft[2 * k].toDouble(), fft[2 * k + 1].toDouble())
      val frequency = k * hzPerBin
      if (frequency >= BAND_EDGES.first() && frequency < BAND_EDGES.last()) {
        energy += magnitude * magnitude
        speechBins++
        for (band in sums.indices) {
          if (frequency >= BAND_EDGES[band] && frequency < BAND_EDGES[band + 1]) {
            sums[band] += magnitude
            counts[band]++
            break
          }
        }
      }
      k++
    }
    val level = normalize(if (speechBins > 0) sqrt(energy / speechBins) else 0.0)
    val bands = sums.indices.map { normalize(if (counts[it] > 0) sums[it] / counts[it] else 0.0) }
    sendEvent("onOutputLevel", mapOf("level" to level, "bands" to bands))
  }

  /** Амплитуда байтового FFT → 0..1 по логарифмической шкале (тишина ≈ 0, громкая речь ≈ 1). */
  private fun normalize(magnitude: Double) = ((20 * log10(magnitude + 1.0) - 4.0) / 30.0).coerceIn(0.0, 1.0)

  private companion object {
    /** Полосы речи, Гц: основной тон, первая форманта, середина, вторая форманта, «воздух». */
    val BAND_EDGES = doubleArrayOf(80.0, 250.0, 500.0, 1000.0, 2000.0, 5000.0)
  }
}
