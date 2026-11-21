package com.imeet.voice

import android.media.AudioTrack
import org.jtransforms.fft.FloatFFT_1D
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.log10
import kotlin.math.sqrt

/**
 * Громкость и пять полос спектра того, что сейчас звучит из нашей дорожки, — для волны.
 * Считается по самим сэмплам в точке воспроизведения (playbackHeadPosition), раз в 40 мс:
 * точно совпадает со слогами и не зависит от Visualizer (которому нужен общий выход системы).
 */
class LevelMeter(
  private val track: AudioTrack,
  private val rate: Int,
  private val emit: (level: Double, bands: List<Double>) -> Unit,
) {
  private class Piece(val start: Long, val data: FloatArray)
  private val pieces = ArrayList<Piece>()
  @Volatile private var running = true
  private val window = FloatArray(N) { (0.5 - 0.5 * cos(2 * PI * it / (N - 1))).toFloat() }
  private val fft = FloatFFT_1D(N.toLong())
  private val thread = Thread {
    val buf = FloatArray(N)
    while (running) {
      try { Thread.sleep(40) } catch (_: InterruptedException) { break }
      val head = runCatching { track.playbackHeadPosition.toLong() and 0xffffffffL }.getOrDefault(0L)
      fill(head, buf)
      emitFrom(buf)
    }
  }.apply { isDaemon = true; name = "imeet-level"; start() }

  /** Кусок звука, который начинается в кадре start дорожки (паузы между кусками — тишина). */
  fun add(start: Long, data: FloatArray) = synchronized(pieces) { pieces.add(Piece(start, data)) }

  fun stop() {
    running = false
    thread.interrupt()
    emit(0.0, List(5) { 0.0 })
  }

  private fun fill(head: Long, out: FloatArray) {
    java.util.Arrays.fill(out, 0f)
    val from = head - N / 2
    synchronized(pieces) {
      for (p in pieces) {
        val a = maxOf(from, p.start)
        val b = minOf(from + N, p.start + p.data.size)
        if (a >= b) continue
        System.arraycopy(p.data, (a - p.start).toInt(), out, (a - from).toInt(), (b - a).toInt())
      }
      // Уже проигранное больше не нужно.
      pieces.removeAll { it.start + it.data.size < from - rate }
    }
  }

  private fun emitFrom(buf: FloatArray) {
    var sum = 0.0
    for (v in buf) sum += v * v
    val level = db(sqrt(sum / N), 60.0)
    for (i in 0 until N) buf[i] *= window[i]
    fft.realForward(buf)
    val hzPerBin = rate.toDouble() / N
    val bands = DoubleArray(EDGES.size - 1)
    val counts = IntArray(EDGES.size - 1)
    for (k in 1 until N / 2) {
      val f = k * hzPerBin
      val band = EDGES.indices.indexOfFirst { it < EDGES.size - 1 && f >= EDGES[it] && f < EDGES[it + 1] }
      if (band < 0) continue
      val re = buf[2 * k].toDouble()
      val im = buf[2 * k + 1].toDouble()
      bands[band] += re * re + im * im
      counts[band]++
    }
    emit(level, bands.indices.map { i -> if (counts[i] == 0) 0.0 else db(sqrt(bands[i] / counts[i]) * 2 / N, 70.0) })
  }

  /** Амплитуда → 0..1 по децибелам: floor дБ и тише — 0, −10 дБ и громче — 1. */
  private fun db(amplitude: Double, floor: Double) = ((20 * log10(amplitude + 1e-9) + floor) / (floor - 10)).coerceIn(0.0, 1.0)

  private companion object {
    const val N = 1024
    val EDGES = doubleArrayOf(80.0, 250.0, 500.0, 1000.0, 2000.0, 5000.0)
  }
}
