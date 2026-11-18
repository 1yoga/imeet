package com.imeet.supertonic

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference

class IMeetSupertonicModule : Module() {
  private val worker = Executors.newSingleThreadExecutor()
  private val engine = SupertonicEngine()
  private val active = AtomicReference<SupertonicOperation?>()

  override fun definition() = ModuleDefinition {
    Name("IMeetSupertonic")
    Events("onModelProgress")

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
        null
      }
    }

    AsyncFunction("play") { text: String, speed: Double, promise: Promise ->
      runOperation(promise) { operation -> engine.play(text, speed.toFloat(), operation) }
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
}
