package com.imeet.supertonic

import java.io.File
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

internal object SupertonicModel {
  private const val REVISION = "cca5a0e6c96e1d2c720986bf7e75fcc81dee3ae4"
  private const val BASE_URL =
    "https://huggingface.co/csukuangfj2/sherpa-onnx-supertonic-3-tts-int8-2026-05-11/resolve/$REVISION"

  private data class ModelFile(val name: String, val size: Long, val sha256: String)

  private val files = listOf(
    ModelFile("duration_predictor.int8.onnx", 3_700_147, "c3eb91414d5ff8a7a239b7fe9e34e7e2bf8a8140d8375ffb14718b1c639325db"),
    ModelFile("text_encoder.int8.onnx", 36_416_150, "c7befd5ea8c3119769e8a6c1486c4edc6a3bc8365c67621c881bbb774b9902ff"),
    ModelFile("vector_estimator.int8.onnx", 78_400_833, "20cd86fa5c6effedfda0e7cffe5b0569ca401c440a0c3a1d72bf39286c0db3fd"),
    ModelFile("vocoder.int8.onnx", 25_991_073, "e923d60f53f95eb1ce235f1dc33ec56d9c057823c96fa6f8acf98f32b0da6152"),
    ModelFile("tts.json", 8_253, "42078d3aef1cd43ab43021f3c54f47d2d75ceb4e75f627f118890128b06a0d09"),
    ModelFile("unicode_indexer.bin", 262_144, "8402ca48e5189a8950138580b0fff64db6f072f24ac07cd54ba8b2fbb9883b30"),
    ModelFile("voice.bin", 517_168, "67d5209b0ee8ce6c74105ffbe12fe6a7628aea3b4ba2fcb308a4a67938a93ce8"),
  )

  fun ensure(baseDir: File, operation: SupertonicOperation, progress: (Long, Long) -> Unit): File {
    val directory = File(baseDir, "imeet-supertonic/$REVISION")
    check(directory.isDirectory || directory.mkdirs()) { "Не удалось создать кэш Supertonic" }

    var verifiedBytes = 0L
    val missing = files.filter { entry ->
      operation.check()
      val file = File(directory, entry.name)
      val valid = file.isFile && file.length() == entry.size &&
        file.inputStream().use { sha256(it, operation) } == entry.sha256
      if (valid) verifiedBytes += entry.size
      !valid
    }
    val total = files.sumOf { it.size }
    for (entry in missing) {
      operation.check()
      progress(verifiedBytes, total)
      download(directory, entry, operation) { progress(verifiedBytes + it, total) }
      verifiedBytes += entry.size
      progress(verifiedBytes, total)
    }
    return directory
  }

  private fun download(
    directory: File,
    entry: ModelFile,
    operation: SupertonicOperation,
    progress: (Long) -> Unit,
  ) {
    val target = File(directory, entry.name)
    val partial = File(directory, "${entry.name}.part")
    val connection = (URL("$BASE_URL/${entry.name}").openConnection() as HttpURLConnection).apply {
      connectTimeout = 20_000
      readTimeout = 20_000
      instanceFollowRedirects = true
      setRequestProperty("Accept-Encoding", "identity")
    }
    try {
      val status = connection.responseCode
      if (status != HttpURLConnection.HTTP_OK) throw IOException("Supertonic: HTTP $status для ${entry.name}")
      val digest = MessageDigest.getInstance("SHA-256")
      val buffer = ByteArray(128 * 1024)
      var received = 0L
      var lastReported = 0L
      connection.inputStream.use { input ->
        partial.outputStream().buffered().use { output ->
          while (true) {
            operation.check()
            val count = input.read(buffer)
            if (count < 0) break
            received += count
            if (received > entry.size) throw IOException("Неверный размер ${entry.name}")
            digest.update(buffer, 0, count)
            output.write(buffer, 0, count)
            if (received - lastReported >= 1024 * 1024) {
              progress(received)
              lastReported = received
            }
          }
        }
      }
      if (received != entry.size || digest.hex() != entry.sha256) {
        throw IOException("Supertonic: проверка SHA-256 или размера не прошла для ${entry.name}")
      }
      operation.check()
      if (!partial.renameTo(target)) throw IOException("Не удалось сохранить ${entry.name}")
    } finally {
      connection.disconnect()
      partial.delete()
    }
  }

  private fun sha256(input: InputStream, operation: SupertonicOperation): String {
    val digest = MessageDigest.getInstance("SHA-256")
    val buffer = ByteArray(128 * 1024)
    while (true) {
      operation.check()
      val count = input.read(buffer)
      if (count < 0) break
      digest.update(buffer, 0, count)
    }
    return digest.hex()
  }

  private fun MessageDigest.hex(): String = digest().joinToString("") { "%02x".format(it) }
}
