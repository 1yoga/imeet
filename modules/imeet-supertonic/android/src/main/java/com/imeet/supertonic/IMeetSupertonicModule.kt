package com.imeet.supertonic

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import android.content.Context
import android.os.Debug
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference

class IMeetSupertonicModule : Module() {
  private val worker = Executors.newSingleThreadExecutor()
  private val engine = SupertonicEngine()
  private val active = AtomicReference<SupertonicOperation?>()

  override fun definition() = ModuleDefinition {
    Name("IMeetSupertonic")
    Events("onModelProgress", "onDictionaryProgress", "onPlaybackMetrics")

    OnCreate {
      val directory = appContext.reactContext?.noBackupFilesDir
      if (directory != null) worker.execute {
        File(directory, "imeet-piper").deleteRecursively()
        File(directory, "imeet-kokoro").deleteRecursively()
      }
    }

    AsyncFunction("snapshot") { category: String ->
      val context = checkNotNull(appContext.reactContext)
      val memory = Debug.MemoryInfo()
      Debug.getMemoryInfo(memory)
      val folder = when (category) {
        "supertonic" -> "imeet-supertonic"
        else -> null
      }
      val bytes = folder?.let { name ->
        File(context.noBackupFilesDir, name).walkTopDown()
          .filter { it.isFile }
          .sumOf { it.length() }
      } ?: 0L
      mapOf("appPssKb" to memory.totalPss, "modelBytes" to bytes)
    }

    AsyncFunction("dictionaryStatus") {
      val context = checkNotNull(appContext.reactContext)
      mapOf(
        "enabled" to engine.isDictionaryEnabled(),
        "cachedBytes" to SupertonicAccentDictionary.cachedFile(context.noBackupFilesDir).let { if (it.isFile) it.length() else 0L },
        "totalBytes" to SupertonicAccentDictionary.DOWNLOAD_SIZE,
      )
    }

    AsyncFunction("setDictionaryEnabled") { enabled: Boolean, promise: Promise ->
      val context = checkNotNull(appContext.reactContext)
      runOperation(promise) { operation ->
        if (enabled) {
          engine.enableDictionary(context.noBackupFilesDir, operation) { received, total ->
            if (!operation.cancelled) sendEvent("onDictionaryProgress", mapOf(
              "receivedBytes" to received,
              "totalBytes" to total,
            ))
          }
        } else {
          engine.disableDictionary()
        }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
          .putBoolean(DICTIONARY_ENABLED, enabled).apply()
        null
      }
    }

    AsyncFunction("prefetchModel") { promise: Promise ->
      val directory = checkNotNull(appContext.reactContext).noBackupFilesDir
      runOperation(promise) { operation ->
        engine.prefetchModel(directory, operation) { received, total ->
          if (!operation.cancelled) sendEvent("onModelProgress", mapOf(
            "receivedBytes" to received,
            "totalBytes" to total,
          ))
        }
        null
      }
    }

    AsyncFunction("initialize") { promise: Promise ->
      val directory = checkNotNull(appContext.reactContext).noBackupFilesDir
      runOperation(promise) { operation ->
        engine.initialize(directory, operation) { received, total ->
          if (!operation.cancelled) sendEvent("onModelProgress", mapOf(
            "receivedBytes" to received,
            "totalBytes" to total,
          ))
        }
        val context = checkNotNull(appContext.reactContext)
        if (context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(DICTIONARY_ENABLED, false)) {
          engine.enableDictionary(directory, operation) { received, total ->
            if (!operation.cancelled) sendEvent("onDictionaryProgress", mapOf(
              "receivedBytes" to received,
              "totalBytes" to total,
            ))
          }
        }
        null
      }
    }

    AsyncFunction("play") { text: String, speed: Double, promise: Promise ->
      runOperation(promise) { operation ->
        engine.play(text, speed.toFloat(), 1, operation) { _, _, _, _ -> }
      }
    }

    AsyncFunction("playVoice") { text: String, speed: Double, voiceId: Int, requestId: Int, promise: Promise ->
      runOperation(promise) { operation ->
        engine.play(text, speed.toFloat(), voiceId, operation) { synthesisMs, firstFrameMs, dictionaryMs, stressReplacements ->
          sendEvent("onPlaybackMetrics", mapOf(
            "requestId" to requestId,
            "synthesisMs" to synthesisMs,
            "firstFrameMs" to firstFrameMs,
            "dictionaryMs" to dictionaryMs,
            "stressReplacements" to stressReplacements,
          ))
        }
      }
    }

    AsyncFunction("stop") {
      active.get()?.cancel()
    }

    AsyncFunction("dispose") { promise: Promise ->
      active.get()?.cancel()
      worker.execute {
        runCatching { engine.release() }.fold(
          onSuccess = { promise.resolve(null) },
          onFailure = { promise.reject("ERR_SUPERTONIC_RELEASE", it.message, it) },
        )
      }
    }

    OnDestroy {
      active.get()?.cancel()
      worker.execute { engine.release() }
      worker.shutdown()
    }
  }

  private fun runOperation(promise: Promise, run: (SupertonicOperation) -> Any?) {
    val operation = SupertonicOperation()
    if (!active.compareAndSet(null, operation)) {
      promise.reject("ERR_SUPERTONIC_BUSY", "Supertonic уже выполняет операцию", null)
      return
    }
    worker.execute {
      val result = runCatching { run(operation) }
      active.compareAndSet(operation, null)
      result.fold(
        onSuccess = { promise.resolve(it) },
        onFailure = { promise.reject("ERR_SUPERTONIC", it.message, it) },
      )
    }
  }

  private companion object {
    const val PREFS = "imeet_supertonic"
    const val DICTIONARY_ENABLED = "dictionary_enabled"
  }
}
