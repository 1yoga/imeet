package com.imeet.voice

import android.content.Context
import android.util.Log
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.zip.ZipInputStream

/**
 * Модели встроенного голоса Silero не лежат в APK: при первом запуске скачиваются одним zip
 * с того же хоста, что и модели «Наслуха», проверяются по SHA-256 и распаковываются в
 * noBackupFilesDir/imeet-voice-<версия>/. Архив собирает tools\pack-voice-models.cmd.
 */
object VoiceModelStore {
  private const val TAG = "IMeetVoiceModels"
  const val VERSION = "1"
  const val ZIP_URL = "https://models.1yoga.link/imeet-voice-models-1.zip"
  const val ZIP_SHA256 = "71ae5ebac21c202002aca74c2060879acbbda1eff49fec04de103589c6be11e1"

  private val REQUIRED = listOf(
    "config.json", "dur.onnx", "pitch.onnx", "pitch_focus.onnx", "encoder.onnx", "dec_pre.onnx", "dec_mid.onnx",
    "dec_post.onnx", "vocoder.onnx", "accent_heads.onnx", "accent_ngrams.txt", "accent_emb.f32",
    "accent_exceptions.tsv", "istft_window.f32",
  )
  private const val COMPLETE = ".complete"

  fun dir(context: Context) = File(context.noBackupFilesDir, "imeet-voice-$VERSION")

  fun isReady(context: Context): Boolean {
    val d = dir(context)
    return File(d, COMPLETE).exists() && REQUIRED.all { File(d, it).length() > 0 }
  }

  /** Скачать и распаковать, если ещё нет. progress(доля 0..1, текст). */
  fun ensure(context: Context, progress: (Double, String) -> Unit) {
    if (isReady(context)) return
    val target = dir(context)
    val staging = File(context.noBackupFilesDir, "imeet-voice-$VERSION.tmp")
    staging.deleteRecursively()
    staging.mkdirs()
    // Сборки для разработки ещё могут нести модели в APK (assets/silero) — тогда без сети.
    if (copyBundled(context, staging)) {
      Log.i(TAG, "модели взяты из APK")
    } else {
      val zip = File(context.cacheDir, "imeet-voice-models.zip")
      try {
        download(ZIP_URL, zip, progress)
        progress(0.92, "Проверяем файлы голоса…")
        val actual = sha256(zip)
        check(actual == ZIP_SHA256) { "Архив голоса повреждён (SHA-256 $actual), попробуйте ещё раз" }
        progress(0.95, "Распаковываем голос…")
        unzipFlat(zip, staging)
      } finally {
        zip.delete()
      }
    }
    val missing = REQUIRED.filter { File(staging, it).length() <= 0 }
    check(missing.isEmpty()) { "В архиве голоса нет файлов: ${missing.joinToString()}" }
    File(staging, COMPLETE).writeText(VERSION)
    target.deleteRecursively()
    check(staging.renameTo(target)) { "Не удалось сохранить модели голоса" }
    // Старые версии и копии моделей из прежних сборок (когда модели были в APK) больше не нужны.
    context.noBackupFilesDir.listFiles()?.forEach { f ->
      if (f != target && (f.name.startsWith("imeet-voice-") || f.name == "silero-onnx")) f.deleteRecursively()
    }
    progress(1.0, "Голос готов")
  }

  private fun copyBundled(context: Context, dest: File): Boolean {
    val names = runCatching { context.assets.list("silero")?.toList() }.getOrNull().orEmpty()
    if ("vocoder.onnx" !in names) return false
    for (name in names) {
      context.assets.open("silero/$name").use { input -> FileOutputStream(File(dest, name)).use { input.copyTo(it, 1 shl 20) } }
    }
    return true
  }

  private fun download(urlStr: String, dest: File, progress: (Double, String) -> Unit) {
    dest.delete()
    dest.parentFile?.mkdirs()
    val conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
      connectTimeout = 60_000
      readTimeout = 180_000
      instanceFollowRedirects = true
      setRequestProperty("User-Agent", "iMeet/voice-models")
      setRequestProperty("Accept-Encoding", "identity")
    }
    try {
      progress(0.01, "Подключаемся к серверу…")
      val code = conn.responseCode
      check(code in 200..299) { "Сервер ответил $code при скачивании голоса" }
      val length = conn.contentLengthLong
      BufferedInputStream(conn.inputStream).use { input ->
        FileOutputStream(dest).use { output ->
          val buf = ByteArray(256 * 1024)
          var total = 0L
          var lastMb = -1L
          while (true) {
            val n = input.read(buf)
            if (n < 0) break
            output.write(buf, 0, n)
            total += n
            val mb = total / (1024 * 1024)
            if (mb != lastMb) {
              lastMb = mb
              val frac = if (length > 0) total.toDouble() / length else 0.0
              val text = if (length > 0) "Скачиваем голос: $mb / ${length / (1024 * 1024)} МБ" else "Скачиваем голос: $mb МБ"
              progress(frac * 0.9, text)
            }
          }
          check(length <= 0 || total == length) { "Скачивание голоса оборвалось, попробуйте ещё раз" }
        }
      }
    } finally {
      conn.disconnect()
    }
  }

  /** Файлы архива — в одну папку (вложенные пути в архиве не важны). */
  private fun unzipFlat(zip: File, dest: File) {
    ZipInputStream(BufferedInputStream(FileInputStream(zip))).use { zis ->
      var entry = zis.nextEntry
      while (entry != null) {
        val name = entry.name.replace('\\', '/').substringAfterLast('/')
        if (!entry.isDirectory && name.isNotEmpty() && !name.contains("..")) {
          FileOutputStream(File(dest, name)).use { out -> zis.copyTo(out, 256 * 1024) }
        }
        zis.closeEntry()
        entry = zis.nextEntry
      }
    }
  }

  private fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    FileInputStream(file).use { input ->
      val buf = ByteArray(256 * 1024)
      while (true) {
        val n = input.read(buf)
        if (n < 0) break
        digest.update(buf, 0, n)
      }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }
}
