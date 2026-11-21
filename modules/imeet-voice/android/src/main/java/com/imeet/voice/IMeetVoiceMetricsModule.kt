package com.imeet.voice

import android.os.Debug
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

/** Замер памяти процесса для Voice Lab (PSS после озвучки). */
class IMeetVoiceMetricsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("IMeetVoiceMetrics")

    OnCreate {
      // Модели прежних экспериментов с TTS больше не нужны: освобождаем место на телефоне.
      val directory = appContext.reactContext?.noBackupFilesDir ?: return@OnCreate
      Executors.newSingleThreadExecutor().apply {
        execute {
          listOf("imeet-supertonic", "imeet-supertonic-dictionary", "imeet-piper", "imeet-kokoro").forEach { File(directory, it).deleteRecursively() }
        }
        shutdown()
      }
    }

    AsyncFunction("snapshot") {
      val memory = Debug.MemoryInfo()
      Debug.getMemoryInfo(memory)
      mapOf("appPssKb" to memory.totalPss)
    }

    // Запись из JS (Voice Lab, разговор): к ней добавляется память процесса на этот момент.
    AsyncFunction("log") { event: String, json: String ->
      val context = appContext.reactContext
      if (context == null) {
        0
      } else {
        val data = runCatching { JSONObject(json) }.getOrElse { JSONObject().put("raw", json) }
        data.put("memory", VoiceMetricsLog.memory())
        VoiceMetricsLog.append(context, event, data)
        VoiceMetricsLog.count(context) + 1
      }
    }

    AsyncFunction("logInfo") {
      val context = appContext.reactContext
      mapOf(
        "path" to (context?.let { VoiceMetricsLog.file(it).absolutePath } ?: ""),
        "records" to (context?.let { VoiceMetricsLog.count(it) } ?: 0),
      )
    }
  }
}
