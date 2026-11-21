package com.imeet.supertonic

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Locale
import java.util.UUID

/** Selects an installed Android TTS engine and a concrete voice; never falls back to another engine. */
class IMeetDeviceTtsModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private var active: TextToSpeech? = null
  private var activePromise: Promise? = null
  private var activeId: String? = null
  private var timeout: Runnable? = null

  override fun definition() = ModuleDefinition {
    Name("IMeetDeviceTts")
    Events("onSpeechStart")

    AsyncFunction("inspect") { enginePackage: String, voiceQuery: String, promise: Promise ->
      main.post {
        val context = checkNotNull(appContext.reactContext)
        var probe: TextToSpeech? = null
        probe = TextToSpeech(context, { status ->
          val tts = probe
          if (status != TextToSpeech.SUCCESS || tts == null) {
            promise.resolve(mapOf("available" to false, "reason" to "Движок не запустился"))
          } else {
            val installed = tts.engines.any { it.name == enginePackage }
            val languageAvailable = installed && tts.isLanguageAvailable(RUSSIAN) >= TextToSpeech.LANG_AVAILABLE
            val selected = if (languageAvailable) selectVoice(tts, voiceQuery) else null
            promise.resolve(mapOf(
              "available" to (installed && selected != null),
              "voiceName" to (selected?.name ?: ""),
              "reason" to (if (!installed) "Установите движок" else if (!languageAvailable) "Установите русский язык и голос в приложении движка" else if (selected == null) "Голос не установлен" else ""),
            ))
          }
          tts?.shutdown()
        }, enginePackage)
      }
    }

    AsyncFunction("speak") { enginePackage: String, voiceQuery: String, text: String, requestId: Int, promise: Promise ->
      main.post {
        if (activePromise != null) {
          promise.reject("ERR_DEVICE_TTS_BUSY", "Озвучка уже идёт", null)
          return@post
        }
        if (text.isBlank() || text.length > 500) {
          promise.reject("ERR_DEVICE_TTS_TEXT", "Некорректная длина реплики", null)
          return@post
        }
        activePromise = promise
        scheduleTimeout(30_000, "Движок не начал озвучку. Проверьте голос внутри RHVoice")
        val context = checkNotNull(appContext.reactContext)
        val startedAt = SystemClock.elapsedRealtime()
        var tts: TextToSpeech? = null
        tts = TextToSpeech(context, { status ->
          val instance = tts
          if (activePromise !== promise) {
            instance?.shutdown()
          } else if (status != TextToSpeech.SUCCESS || instance == null ||
            !instance.engines.any { it.name == enginePackage }) {
            finishError("Движок не установлен или не запустился")
          } else {
            val voice = if (instance.isLanguageAvailable(RUSSIAN) >= TextToSpeech.LANG_AVAILABLE) selectVoice(instance, voiceQuery) else null
            if (voice == null || instance.setVoice(voice) != TextToSpeech.SUCCESS) {
              finishError("Русский голос не установлен в приложении движка")
            } else {
              val id = UUID.randomUUID().toString()
              activeId = id
              instance.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String) {
                  if (utteranceId == id) {
                    sendEvent("onSpeechStart", mapOf(
                      "requestId" to requestId,
                      "firstFrameMs" to (SystemClock.elapsedRealtime() - startedAt),
                    ))
                    main.post { if (activeId == id) scheduleTimeout(120_000, "Движок не завершил озвучку") }
                  }
                }
                override fun onDone(utteranceId: String) {
                  if (utteranceId == id) main.post { finish("completed") }
                }
                override fun onError(utteranceId: String) {
                  if (utteranceId == id) main.post { finishError("Ошибка синтеза речи") }
                }
                override fun onError(utteranceId: String, errorCode: Int) {
                  if (utteranceId == id) main.post { finishError("Ошибка синтеза речи: $errorCode") }
                }
                override fun onStop(utteranceId: String, interrupted: Boolean) {
                  if (utteranceId == id) main.post { finish("stopped") }
                }
              })
              if (instance.speak(text, TextToSpeech.QUEUE_FLUSH, null, id) != TextToSpeech.SUCCESS) {
                finishError("Движок отклонил реплику")
              }
            }
          }
        }, enginePackage)
        active = tts
      }
    }

    AsyncFunction("stop") {
      main.post {
        active?.stop()
        finish("stopped")
      }
    }

    OnDestroy {
      main.post {
        active?.stop()
        finish("stopped")
      }
    }
  }

  private fun selectVoice(tts: TextToSpeech, query: String) = tts.voices
    ?.filter { it.locale.language == "ru" }
    ?.firstOrNull { query.isEmpty() || it.name.equals(query, true) || it.name.endsWith("/$query", true) || it.name.endsWith("-$query", true) }

  private companion object {
    val RUSSIAN: Locale = Locale.forLanguageTag("ru-RU")
  }

  private fun finish(result: String) {
    clearTimeout()
    activePromise?.resolve(result)
    activePromise = null
    activeId = null
    active?.shutdown()
    active = null
  }

  private fun finishError(message: String) {
    clearTimeout()
    activePromise?.reject("ERR_DEVICE_TTS", message, null)
    activePromise = null
    activeId = null
    active?.shutdown()
    active = null
  }

  private fun scheduleTimeout(delayMs: Long, message: String) {
    clearTimeout()
    val task = Runnable { if (activePromise != null) finishError(message) }
    timeout = task
    main.postDelayed(task, delayMs)
  }

  private fun clearTimeout() {
    timeout?.let(main::removeCallbacks)
    timeout = null
  }
}
