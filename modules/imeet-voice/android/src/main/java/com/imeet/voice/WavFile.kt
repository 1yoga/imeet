package com.imeet.voice

import android.content.Context
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Запись WAV для сравнения голосов: files/compare/<имя>.wav (забирает tools\pull-compare.cmd). */
object WavFile {
  fun compareFile(context: Context, name: String): File {
    val dir = File(context.getExternalFilesDir(null) ?: context.filesDir, "compare").apply { mkdirs() }
    return File(dir, name.replace(Regex("[^A-Za-z0-9_.-]"), "_") + ".wav")
  }

  fun write(file: File, data: ByteArray, rate: Int, channels: Int, bits: Int, float: Boolean) {
    val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN).apply {
      put("RIFF".toByteArray()); putInt(36 + data.size); put("WAVE".toByteArray())
      put("fmt ".toByteArray()); putInt(16); putShort(if (float) 3 else 1); putShort(channels.toShort())
      putInt(rate); putInt(rate * channels * bits / 8); putShort((channels * bits / 8).toShort()); putShort(bits.toShort())
      put("data".toByteArray()); putInt(data.size)
    }
    FileOutputStream(file).use { it.write(header.array()); it.write(data) }
  }

  fun writeFloat(file: File, audio: FloatArray, rate: Int) {
    val bytes = ByteBuffer.allocate(audio.size * 4).order(ByteOrder.LITTLE_ENDIAN)
    audio.forEach { bytes.putFloat(it) }
    write(file, bytes.array(), rate, 1, 32, true)
  }
}
