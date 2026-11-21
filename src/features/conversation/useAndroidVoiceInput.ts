import {
  addNaslukhProgressListener,
  createSpeechEngine,
  GIGAAM_MODEL_ID,
  type SpeechMonitor,
} from '@naslukh/speech-rn';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, PermissionsAndroid, Platform } from 'react-native';

import { hasAndroidTts, loadAndroidTts } from '@/core/voice/androidTts';
import type { TtsEngine, TtsPlaybackHandle } from '@/core/voice/contracts';
import {
  type ConversationSettings,
  defaultConversationSettings,
  loadConversationSettings,
  normalizeSettings,
  saveConversationSettings,
} from '@/core/settings/conversationSettings';
import { createDeviceTtsEngine, hasDeviceTts, inspectDeviceVoice } from '@/core/voice/deviceTts';
import { stripFocusMarks } from '@/core/voice/focusMarks';
import {
  defaultConversationVoiceId,
  findDeviceVoice,
  loadConversationVoiceId,
  saveConversationVoiceId,
} from '@/core/voice/voiceCatalog';

import { mockConversationService } from './mockConversationService';
import type { ConversationStatus } from './types';

const speech = Platform.OS === 'android' ? createSpeechEngine({ allowStub: false }) : null;
let modelReady = false;
let modelPreparation: Promise<void> | undefined;
let voiceInUse = false;

type ModelState =
  | { phase: 'loading'; message: string; progress?: number }
  | { phase: 'ready' }
  | { phase: 'error'; message: string };

type VoicePhase = ConversationStatus | 'stopping' | 'ending';

interface Feedback {
  phase: VoicePhase;
  message?: string;
}

interface ListenTurn {
  phase: VoicePhase;
  nativeReady: boolean;
  cancelSent: boolean;
  command: Promise<void>;
}

interface Conversation {
  cancelled: boolean;
  /** Короткая реакция в паузе пользователя и время последней. */
  backchannel?: TtsPlaybackHandle;
  lastBackchannelAt: number;
  requestingPermission: boolean;
  stopFailed: boolean;
  turn?: ListenTurn;
  playback?: TtsPlaybackHandle;
  playbackStop?: Promise<void>;
  preparingTts?: TtsEngine;
  preparationStop?: Promise<void>;
}

function prepareModel() {
  if (!speech || modelReady) return Promise.resolve();

  // A download can outlive the screen. Share it with the next mount.
  modelPreparation ??= speech.ensureModel(GIGAAM_MODEL_ID)
    .then(() => { modelReady = true; })
    .finally(() => { modelPreparation = undefined; });
  return modelPreparation;
}

function cancelListening(session: Conversation) {
  const turn = session.turn;
  // The first listen event confirms that Naslukh has an active native session.
  if (!speech || !turn?.nativeReady || turn.cancelSent) return;

  const engine = speech;
  turn.cancelSent = true;
  turn.command = turn.command.then(() => engine.cancelListenOnce()).catch(() => {
    session.stopFailed = true;
  });
}

function stopPlayback(session: Conversation) {
  if (!session.playback || session.playbackStop) return;

  session.playbackStop = session.playback.stop().catch(() => {
    session.stopFailed = true;
  });
}

function cancelConversation(session: Conversation) {
  session.cancelled = true;
  cancelListening(session);
  stopPlayback(session);
  if (session.preparingTts && !session.preparationStop) {
    session.preparationStop = session.preparingTts.stop().catch(() => {
      session.stopFailed = true;
    });
  }
}

/** Замеры для отладочной строки состояния: распознавание и время до первого звука ответа. */
export interface Timings {
  recognitionMs?: number;
  replyMs?: number;
}

/** Короткие реакции в паузе внутри реплики: слова, а не междометия — синтез их произносит естественно. */
const backchannels = ['Понятно.', 'Ага.', 'Так.', 'Интересно.', 'Вот как.', 'Да-да.'];
let lastBackchannel = -1;
function pickBackchannel() {
  let index = Math.floor(Math.random() * backchannels.length);
  if (index === lastBackchannel) index = (index + 1) % backchannels.length;
  lastBackchannel = index;
  return backchannels[index];
}

/** Не чаще одной реакции за столько миллисекунд. */
const BACKCHANNEL_COOLDOWN_MS = 4000;

/** dBFS → 0…1 для анимации: тишина комнаты около −60, громкая речь около −15. */
function levelFromDbfs(dbfs: number) {
  return Math.min(1, Math.max(0, (dbfs + 60) / 45));
}

function isSilence(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  return message.includes('Речь не обнаружена') || message.includes('Речь слишком короткая');
}

/** Голос ответа: Silero из профиля через RuVoice, если он установлен, иначе системный TTS. */
async function prepareTts(sileroVoiceId: string, sileroAvailable: boolean | null): Promise<TtsEngine | null> {
  if (hasDeviceTts && sileroAvailable !== false) {
    const voice = findDeviceVoice(sileroVoiceId);
    const engine = createDeviceTtsEngine(voice.engine, voice.query);
    try {
      await engine.initialize();
      return engine;
    } catch {
      // RuVoice или голос недоступен: отвечаем системным голосом.
    }
  }
  const system = await loadAndroidTts();
  await system?.initialize();
  return system;
}

/** Откуда берутся ответы агента: общий разговор или, например, вопросы о кандидате. */
export interface ReplySession {
  replyTo(text: string): string;
}

export interface VoiceInputOptions {
  createReplies?: () => ReplySession;
}

export function useAndroidVoiceInput(options: VoiceInputOptions = {}) {
  const current = useRef<Conversation | null>(null);
  const replies = useRef<ReplySession | null>(null);
  replies.current ??= options.createReplies?.() ?? mockConversationService.createSession();
  const [model, setModel] = useState<ModelState>(() => modelReady
    ? { phase: 'ready' }
    : { phase: 'loading', message: 'Проверяем модель речи…' });
  const [modelRetry, setModelRetry] = useState(0);
  const [isActive, setActive] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>({ phase: 'idle' });
  const [transcript, setTranscript] = useState('');
  const [reply, setReply] = useState('');
  const [sileroVoiceId, setSileroVoiceId] = useState(defaultConversationVoiceId);
  const [sileroAvailable, setSileroAvailable] = useState<boolean | null>(hasDeviceTts ? null : false);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  const [textBusy, setTextBusy] = useState(false);
  const [timings, setTimings] = useState<Timings>({});
  const [audioLevel, setAudioLevel] = useState(0);
  const [settings, setSettings] = useState<ConversationSettings>(defaultConversationSettings);
  // Цикл разговора читает настройки на каждом шаге: изменения действуют со следующей реплики.
  const settingsRef = useRef(defaultConversationSettings);
  const textPlayback = useRef<TtsPlaybackHandle | null>(null);

  useEffect(() => {
    if (!speech) return;
    if (modelReady) {
      setModel({ phase: 'ready' });
      return;
    }

    let observing = true;
    setModel({ phase: 'loading', message: 'Проверяем модель речи…' });
    const unsubscribe = addNaslukhProgressListener(({ phase, message, progress }) => {
      if (observing && phase === 'download') {
        setModel({
          phase: 'loading',
          message: message || 'Загружаем модель речи (~163 МиБ)…',
          progress,
        });
      }
    });

    const stopObserving = () => {
      if (!observing) return;
      observing = false;
      unsubscribe();
    };

    void prepareModel().then(() => {
      if (!observing) return;
      stopObserving();
      setModel({ phase: 'ready' });
    }).catch((error: unknown) => {
      if (!observing) return;
      stopObserving();
      const missingModule = error instanceof Error && error.message.includes('NaslukhSpeech не в APK');
      setModel({
        phase: 'error',
        message: missingModule
          ? 'Установите Android-сборку iMeet с модулем распознавания речи.'
          : 'Не удалось подготовить модель. Проверьте интернет и свободное место.',
      });
    });

    return stopObserving;
  }, [modelRetry]);

  // Голос можно поменять и в Voice Lab: перечитываем его при возвращении на экран.
  useFocusEffect(useCallback(() => {
    let mounted = true;
    void loadConversationVoiceId().then((id) => {
      if (mounted) setSileroVoiceId(id);
    });
    void loadConversationSettings().then((value) => {
      if (!mounted) return;
      settingsRef.current = value;
      setSettings(value);
    });
    return () => { mounted = false; };
  }, []));

  useEffect(() => {
    if (!hasDeviceTts) return;
    let observing = true;
    const voice = findDeviceVoice(sileroVoiceId);
    setSileroAvailable(null);
    void inspectDeviceVoice(voice.engine, voice.query)
      .then((result) => { if (observing) setSileroAvailable(result.available); })
      .catch(() => { if (observing) setSileroAvailable(false); });
    return () => { observing = false; };
  }, [sileroVoiceId]);

  const stopTextPlayback = useCallback(() => {
    const playback = textPlayback.current;
    textPlayback.current = null;
    if (playback) void playback.stop().catch(() => {});
  }, []);

  const end = useCallback(() => {
    stopTextPlayback();
    const session = current.current;
    if (!session || session.cancelled) return;

    cancelConversation(session);
    setActive(false);
    setFeedback({ phase: 'ending' });
  }, [stopTextPlayback]);

  useEffect(() => {
    if (!speech) return;

    const subscription = AppState.addEventListener('change', (state) => {
      // Android may pause the app while its microphone permission dialog is open.
      if (state === 'background' && !current.current?.requestingPermission) end();
    });
    return () => {
      subscription.remove();
      const session = current.current;
      current.current = null;
      if (session) cancelConversation(session);
    };
  }, [end]);

  // Волна по громкости: «Наслух» шлёт уровень ≈15 раз в секунду, пока есть подписчик.
  useEffect(() => {
    const off = speech?.addAudioLevelListener?.(({ rmsDbfs }) => setAudioLevel(levelFromDbfs(rmsDbfs)));
    return () => off?.();
  }, []);

  const start = async () => {
    if (!speech || !modelReady || current.current) return;
    // При переходе между экранами предыдущий ещё освобождает микрофон: ждём до 2 с.
    for (let i = 0; voiceInUse && i < 40; i++) await new Promise((resolve) => setTimeout(resolve, 50));
    if (voiceInUse || current.current) return;

    const session: Conversation = {
      cancelled: false,
      requestingPermission: true,
      stopFailed: false,
      lastBackchannelAt: 0,
    };
    current.current = session;
    voiceInUse = true;
    setActive(true);
    setFeedback({ phase: 'preparing' });

    let next: Feedback = { phase: 'idle' };
    let stage: 'permission' | 'tts' | 'recognition' = 'permission';
    let tts: TtsEngine | null = null;
    // Монитор, который услышал перебивание: следующая реплика продолжается с его захвата.
    let bargeInMonitor: SpeechMonitor | null = null;

    try {
      const permission = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      session.requestingPermission = false;
      if (session.cancelled || AppState.currentState === 'background') return;
      if (permission !== PermissionsAndroid.RESULTS.GRANTED) {
        const message = permission === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
          ? 'Разрешите доступ к микрофону в настройках приложения iMeet.'
          : 'Для голосового общения нужен доступ к микрофону.';
        next = { phase: 'error', message };
        return;
      }

      stage = 'tts';
      tts = await prepareTts(sileroVoiceId, sileroAvailable);
      if (session.cancelled) return;

      while (!session.cancelled) {
        stage = 'recognition';
        const turn: ListenTurn = {
          phase: 'preparing',
          nativeReady: false,
          cancelSent: false,
          command: Promise.resolve(),
        };
        session.turn = turn;

        let recognizingAt = 0;
        const update = (phase: VoicePhase) => {
          turn.phase = phase;
          if (phase === 'recognizing') recognizingAt = Date.now();
          setFeedback({ phase });
        };
        update('preparing');

        const unsubscribe = addNaslukhProgressListener(({ phase, message }) => {
          if (phase === 'listen') turn.nativeReady = true;
          else if (phase !== 'asr' || !turn.nativeReady) return;
          if (session.cancelled) {
            cancelListening(session);
            return;
          }
          if (phase === 'asr' && turn.phase !== 'recognizing') {
            update('recognizing');
          } else if (phase === 'listen') {
            if (turn.phase === 'preparing') update('listening');
            if (turn.phase === 'listening' && message === 'Речь обнаружена') update('user-speaking');
          }
        });

        const engine = tts;
        const pauseMs = Math.round(settingsRef.current.backchannelPauseSec * 1000);
        const backchannelOn = pauseMs > 0 && engine !== null && !mutedRef.current;
        // Короткая реакция в паузе: не перебивает, реплика продолжает записываться.
        const offPause = backchannelOn
          ? speech.addSpeechPauseListener?.(() => {
            if (session.cancelled || mutedRef.current || !engine) return;
            const now = Date.now();
            if (now - session.lastBackchannelAt < BACKCHANNEL_COOLDOWN_MS) return;
            session.lastBackchannelAt = now;
            void engine.speak({ text: pickBackchannel(), locale: 'ru-RU' })
              .then((handle) => { session.backchannel = handle; })
              .catch(() => {});
          })
          : undefined;
        const continueFromMonitor = bargeInMonitor?.id;
        bargeInMonitor = null;
        if (continueFromMonitor) update('user-speaking');

        let text = '';
        try {
          text = (await speech.listenOnce({
            language: 'ru',
            vadThreshold: 0.5,
            vadMinSilenceSec: settingsRef.current.endOfPhraseSec,
            ...(backchannelOn ? { speechPauseMs: pauseMs } : {}),
            // Эхоподавление нужно, когда во время записи может звучать сам телефон.
            echoCancellation: backchannelOn || Boolean(continueFromMonitor),
            ...(continueFromMonitor ? { continueFromMonitor } : {}),
          })).text.trim();
        } catch (error) {
          // Экран слушает постоянно: тишина — не ошибка, просто слушаем дальше.
          if (!isSilence(error)) throw error;
        } finally {
          offPause?.();
          unsubscribe();
          setAudioLevel(0);
          turn.nativeReady = false;
          await turn.command;
          session.turn = undefined;
        }

        if (session.cancelled) return;
        if (!text) continue;

        const recognizedAt = Date.now();
        const answer = replies.current!.replyTo(text);
        setTranscript(text);
        setReply(stripFocusMarks(answer));
        setTimings({ recognitionMs: recognizingAt ? recognizedAt - recognizingAt : undefined });

        if (!tts || mutedRef.current) continue;

        stage = 'tts';
        setFeedback({ phase: 'thinking' });
        // Реакция в паузе могла ещё звучать: ответ её сменяет.
        await session.backchannel?.stop().catch(() => {});
        session.backchannel = undefined;
        const delayMs = settingsRef.current.replyDelaySec * 1000;
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          if (session.cancelled) return;
          if (mutedRef.current) continue;
        }
        // Перебивание: монитор слушает, пока агент говорит.
        let monitor: SpeechMonitor | null = null;
        let interrupted = false;
        if (settingsRef.current.bargeIn && speech.monitorSpeech) {
          try {
            monitor = await speech.monitorSpeech({});
            monitor.onSpeech(() => {
              interrupted = true;
              stopPlayback(session);
              if (!session.cancelled) setFeedback({ phase: 'user-speaking' });
            });
          } catch {
            monitor = null; // старая нативная сборка или микрофон занят — отвечаем без перебивания
          }
        }
        try {
          // Naslukh releases AudioRecord before listenOnce settles.
          const playback = await tts.speak({
            // Разметку логического ударения понимает только Silero в RuVoice.
            text: tts.id.startsWith('device:') ? answer : stripFocusMarks(answer),
            locale: 'ru-RU',
            onStart: () => {
              if (session.cancelled) return;
              setFeedback({ phase: 'speaking' });
              setTimings((value) => ({ ...value, replyMs: Date.now() - recognizedAt }));
            },
          });
          session.playback = playback;
          if (session.cancelled || mutedRef.current || interrupted) stopPlayback(session);

          const result = await playback.finished;
          if (!session.cancelled && !mutedRef.current && !interrupted && result === 'stopped') {
            throw new Error('TTS playback was interrupted');
          }
          if (interrupted && monitor && !session.cancelled) {
            // Захват монитора с началом фразы перейдёт в следующий listenOnce.
            bargeInMonitor = monitor;
            monitor = null;
          }
        } catch (error) {
          stopPlayback(session);
          throw error;
        } finally {
          await session.playbackStop;
          session.playback = undefined;
          session.playbackStop = undefined;
          await monitor?.stop().catch(() => {});
        }
      }
    } catch {
      const messages = {
        permission: 'Не удалось получить доступ к микрофону.',
        tts: 'Не удалось озвучить ответ. Проверьте RuVoice или русский голос Android.',
        recognition: 'Не удалось распознать речь. Проверьте доступ к микрофону.',
      };
      next = { phase: 'error', message: messages[stage] };
    } finally {
      await bargeInMonitor?.stop().catch(() => {});
      await session.backchannel?.stop().catch(() => {});
      session.preparingTts = undefined;
      await session.preparationStop;
      try {
        await tts?.stop();
      } catch {
        session.stopFailed = true;
      }
      voiceInUse = false;
      if (current.current === session) {
        current.current = null;
        setActive(false);
        if (session.stopFailed) {
          setFeedback({ phase: 'error', message: 'Не удалось полностью остановить звук.' });
        } else {
          setFeedback(session.cancelled ? { phase: 'idle' } : next);
        }
      }
    }
  };

  /** «Не могу говорить»: ответ на сообщение, набранное текстом. */
  const sendText = async (raw: string) => {
    const text = raw.trim();
    if (!text || textBusy) return;
    setTextBusy(true);
    stopTextPlayback();
    const sentAt = Date.now();
    const answer = replies.current!.replyTo(text);
    setTranscript(text);
    setReply(stripFocusMarks(answer));
    setTimings({});
    let failed = false;
    try {
      if (mutedRef.current) return;
      setFeedback({ phase: 'thinking' });
      const delayMs = settingsRef.current.replyDelaySec * 1000;
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      const tts = await prepareTts(sileroVoiceId, sileroAvailable);
      if (!tts || mutedRef.current) return;
      const playback = await tts.speak({
        text: tts.id.startsWith('device:') ? answer : stripFocusMarks(answer),
        locale: 'ru-RU',
        onStart: () => {
          setFeedback({ phase: 'speaking' });
          setTimings({ replyMs: Date.now() - sentAt });
        },
      });
      textPlayback.current = playback;
      await playback.finished;
    } catch {
      failed = true;
      setFeedback({ phase: 'error', message: 'Не удалось озвучить ответ. Проверьте RuVoice или русский голос Android.' });
    } finally {
      textPlayback.current = null;
      setTextBusy(false);
      if (!failed) setFeedback((value) => (value.phase === 'error' ? value : { phase: 'idle' }));
    }
  };

  /** «Не могу слушать»: ответы показываются текстом и не озвучиваются. */
  const toggleMuted = () => {
    const value = !mutedRef.current;
    mutedRef.current = value;
    setMuted(value);
    if (value) {
      stopTextPlayback();
      const session = current.current;
      if (session) stopPlayback(session);
    }
  };

  const changeVoice = async (id: string) => {
    await saveConversationVoiceId(id);
    setSileroVoiceId(id);
  };

  const updateSettings = async (changes: Partial<ConversationSettings>) => {
    const next = normalizeSettings({ ...settingsRef.current, ...changes });
    settingsRef.current = next;
    setSettings(next);
    await saveConversationSettings(next);
  };

  const clearError = () => {
    if (feedback.phase === 'error') setFeedback({ phase: 'idle' });
  };

  const { phase, message } = feedback;
  const status: ConversationStatus = phase === 'ending' || phase === 'stopping' ? 'recognizing' : phase;
  const retryModel = () => setModelRetry((value) => value + 1);

  return {
    supported: speech !== null,
    hasTts: hasDeviceTts || hasAndroidTts,
    model,
    retryModel,
    isActive,
    phase,
    status,
    message,
    transcript,
    reply,
    start,
    end,
    clearError,
    muted,
    toggleMuted,
    sendText,
    textBusy,
    sileroVoiceId,
    sileroAvailable,
    changeVoice,
    timings,
    settings,
    updateSettings,
    audioLevel,
  };
}
