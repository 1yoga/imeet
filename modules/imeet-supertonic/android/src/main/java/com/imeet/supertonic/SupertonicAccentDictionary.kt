package com.imeet.supertonic

import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.channels.FileChannel
import java.security.MessageDigest
import java.util.Locale

/** Russian-v1.1 pronunciation dictionary from davnozdu/supertonic-dictionaries.
 * The binary SACC layout is documented in that repository. The file is fetched
 * separately and mapped read-only, so it does not become a large JVM HashMap.
 */
internal class SupertonicAccentDictionary private constructor(
  private val file: RandomAccessFile,
  private val bytes: ByteBuffer,
  private val entryCount: Int,
  private val dataOffset: Long,
) {
  data class Result(val text: String, val replacements: Int)

  fun apply(text: String): Result {
    var replacements = 0
    val updated = WORD.replace(text) { match ->
      val word = match.value
      if ('\u0301' in word || '+' in word || 'ё' in word || 'Ё' in word) {
        return@replace word
      }
      val stressed = lookup(word.lowercase(Locale.ROOT).toByteArray(Charsets.UTF_8)) ?: return@replace word
      if (stressed == word) return@replace word
      replacements++
      when {
        word.all { !it.isLetter() || it.isUpperCase() } -> stressed.uppercase(Locale.ROOT)
        word.firstOrNull()?.isUpperCase() == true -> stressed.replaceFirstChar { it.uppercaseChar() }
        else -> stressed
      }
    }
    return Result(updated, replacements)
  }

  private fun lookup(key: ByteArray): String? {
    var low = 0
    var high = entryCount - 1
    while (low <= high) {
      val middle = (low + high).ushr(1)
      val relative = bytes.getInt(HEADER_BYTES + middle * 4).toLong() and 0xffffffffL
      val start = (dataOffset + relative).toInt()
      val keyLength = bytes.getShort(start).toInt() and 0xffff
      val compareLength = minOf(keyLength, key.size)
      var order = 0
      for (index in 0 until compareLength) {
        order = (bytes.get(start + 4 + index).toInt() and 0xff) - (key[index].toInt() and 0xff)
        if (order != 0) break
      }
      if (order == 0) order = keyLength - key.size
      when {
        order < 0 -> low = middle + 1
        order > 0 -> high = middle - 1
        else -> {
          val valueLength = bytes.getShort(start + 2).toInt() and 0xffff
          val valueStart = start + 4 + keyLength
          val value = ByteArray(valueLength) { bytes.get(valueStart + it) }
          return String(value, Charsets.UTF_8)
        }
      }
    }
    return null
  }

  fun close() = file.close()

  companion object {
    private const val VERSION = "russian-v1.1"
    private const val NAME = "russian_accents_full.sacc"
    private const val SIZE = 179_200_764L
    private const val SHA256 = "a1ac32606e99f6d8ab8e8ce796b0005b0693908555460656976c54e171658b27"
    private const val DOWNLOAD_URL = "https://github.com/davnozdu/supertonic-dictionaries/releases/download/$VERSION/$NAME"
    private const val HEADER_BYTES = 28
    private val WORD = Regex("[+\\p{L}\\p{M}]+")

    const val DOWNLOAD_SIZE = SIZE

    fun cachedFile(baseDir: File) = File(baseDir, "imeet-supertonic-dictionary/$VERSION/$NAME")

    fun ensure(baseDir: File, operation: SupertonicOperation, progress: (Long, Long) -> Unit): File {
      val destination = cachedFile(baseDir)
      check(destination.parentFile?.isDirectory == true || destination.parentFile?.mkdirs() == true) {
        "Не удалось создать каталог словаря"
      }
      if (destination.isFile && destination.length() == SIZE && sha256(destination, operation) == SHA256) {
        progress(SIZE, SIZE)
        return destination
      }
      val partial = File(destination.parentFile, "$NAME.part")
      val connection = (URL(DOWNLOAD_URL).openConnection() as HttpURLConnection).apply {
        connectTimeout = 20_000
        readTimeout = 30_000
        instanceFollowRedirects = true
        setRequestProperty("Accept-Encoding", "identity")
      }
      try {
        if (connection.responseCode != HttpURLConnection.HTTP_OK) {
          throw IOException("Словарь: HTTP ${connection.responseCode}")
        }
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(128 * 1024)
        var received = 0L
        var reported = 0L
        connection.inputStream.use { input ->
          partial.outputStream().buffered().use { output ->
            while (true) {
              operation.check()
              val count = input.read(buffer)
              if (count < 0) break
              received += count
              if (received > SIZE) throw IOException("Словарь: неверный размер")
              digest.update(buffer, 0, count)
              output.write(buffer, 0, count)
              if (received - reported >= 1024 * 1024) {
                progress(received, SIZE)
                reported = received
              }
            }
          }
        }
        if (received != SIZE || digest.digest().hex() != SHA256) {
          throw IOException("Словарь: проверка размера или SHA-256 не прошла")
        }
        operation.check()
        if (destination.exists() && !destination.delete()) throw IOException("Не удалось заменить старый словарь")
        if (!partial.renameTo(destination)) throw IOException("Не удалось сохранить словарь")
        progress(SIZE, SIZE)
        return destination
      } finally {
        connection.disconnect()
        partial.delete()
      }
    }

    fun open(file: File): SupertonicAccentDictionary {
      val handle = RandomAccessFile(file, "r")
      try {
        if (handle.length() != SIZE) throw IOException("Неверный размер словаря")
        val bytes = handle.channel.map(FileChannel.MapMode.READ_ONLY, 0, SIZE).order(ByteOrder.LITTLE_ENDIAN)
        if (bytes.get(0) != 'S'.code.toByte() || bytes.get(1) != 'A'.code.toByte() ||
          bytes.get(2) != 'C'.code.toByte() || bytes.get(3) != 'C'.code.toByte() || bytes.getInt(4) != 1) {
          throw IOException("Неизвестный формат словаря")
        }
        val count = bytes.getInt(8)
        val offsetsOffset = bytes.getLong(12)
        val dataOffset = bytes.getLong(20)
        if (count <= 0 || offsetsOffset != HEADER_BYTES.toLong() ||
          dataOffset != HEADER_BYTES + count.toLong() * 4 || dataOffset >= SIZE) {
          throw IOException("Повреждён заголовок словаря")
        }
        return SupertonicAccentDictionary(handle, bytes, count, dataOffset)
      } catch (error: Throwable) {
        handle.close()
        throw error
      }
    }

    private fun sha256(file: File, operation: SupertonicOperation): String {
      val digest = MessageDigest.getInstance("SHA-256")
      file.inputStream().use { input ->
        val buffer = ByteArray(128 * 1024)
        while (true) {
          operation.check()
          val count = input.read(buffer)
          if (count < 0) break
          digest.update(buffer, 0, count)
        }
      }
      return digest.digest().hex()
    }

    private fun ByteArray.hex() = joinToString("") { "%02x".format(it) }
  }
}
