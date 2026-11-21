package com.imeet.voice

import android.content.Context
import android.os.Build
import android.os.Debug
import android.os.SystemClock
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

/**
 * Журнал замеров голоса: одна строка JSON на событие (JSON Lines).
 * Файл: /sdcard/Android/data/<пакет>/files/voice-metrics.jsonl — забирается через adb
 * (tools\pull-metrics.cmd), он же дублируется в logcat с тегом IMeetMetrics.
 */
object VoiceMetricsLog {
  private const val TAG = "IMeetMetrics"
  private const val FILE = "voice-metrics.jsonl"
  private const val MAX_BYTES = 5L shl 20        // 5 МБ, потом старый файл уходит в .1
  private val writer = Executors.newSingleThreadExecutor()
  private val time = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSZ", Locale.US)
  private val session = System.currentTimeMillis().toString(36)

  fun file(context: Context): File = File(context.getExternalFilesDir(null) ?: context.filesDir, FILE)

  /** Добавить запись; поля устройства и времени дописываются сами. Запись — в фоне. */
  fun append(context: Context, event: String, data: JSONObject) {
    data.put("event", event)
    data.put("time", time.format(Date()))
    data.put("session", session)
    data.put("uptimeMs", SystemClock.elapsedRealtime())
    data.put("device", "${Build.MANUFACTURER} ${Build.MODEL}")
    data.put("android", Build.VERSION.SDK_INT)
    data.put("appVersion", runCatching {
      context.packageManager.getPackageInfo(context.packageName, 0).let { "${it.versionName} (${it.lastUpdateTime})" }
    }.getOrDefault("?"))
    val line = data.toString()
    Log.i(TAG, line)
    writer.execute {
      runCatching {
        val f = file(context)
        f.parentFile?.mkdirs()
        if (f.length() > MAX_BYTES) f.renameTo(File(f.parentFile, "$FILE.1"))
        f.appendText(line + "\n")
      }.onFailure { Log.e(TAG, "write failed", it) }
    }
  }

  fun count(context: Context): Int = runCatching { file(context).useLines { it.count() } }.getOrDefault(0)

  /** Память процесса в КБ: PSS целиком и по частям (нативная куча — там живёт ONNX Runtime). */
  fun memory(): JSONObject {
    val info = Debug.MemoryInfo()
    Debug.getMemoryInfo(info)
    val runtime = Runtime.getRuntime()
    return JSONObject().apply {
      put("pssKb", info.totalPss)
      put("nativeHeapKb", Debug.getNativeHeapAllocatedSize() / 1024)
      put("javaHeapKb", (runtime.totalMemory() - runtime.freeMemory()) / 1024)
      info.memoryStats.forEach { (k, v) -> put("stat." + k.removePrefix("summary."), v.toLongOrNull() ?: v) }
    }
  }

  /** Пик нативной кучи за время работы: дешёвый опрос раз в 50 мс в своём потоке. */
  class PeakSampler {
    @Volatile private var running = true
    @Volatile var peakKb = Debug.getNativeHeapAllocatedSize() / 1024
      private set
    private val thread = Thread {
      while (running) {
        val now = Debug.getNativeHeapAllocatedSize() / 1024
        if (now > peakKb) peakKb = now
        try { Thread.sleep(50) } catch (_: InterruptedException) { break }
      }
    }.apply { isDaemon = true; name = "imeet-mem-peak"; start() }

    fun stop(): Long { running = false; thread.interrupt(); return peakKb }
  }
}
