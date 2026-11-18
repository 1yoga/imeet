import {
  addNaslukhProgressListener,
  createSpeechEngine,
  GIGAAM_MODEL_ID,
} from '@naslukh/speech-rn';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, PermissionsAndroid, Platform } from 'react-native';

import { hasAndroidTts, loadAndroidTts } from '@/core/voice/androidTts';
import type { TtsEngine, TtsPlaybackHandle } from '@/core/voice/contracts';
import { hasSupertonicTts, loadSupertonicTts, prefetchSupertonicModel } from '@/core/voice/supertonicTts';

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
  requestingPermission: boolean;
  stopFailed: boolean;
  turn?: ListenTurn;
  playback?: TtsPlaybackHandle;
  playbackStop?: Promise<void>;
  preparingTts?: TtsEngine;
  preparationStop?: Promise<void>;
}

type TtsChoice = 'system' | 'supertonic';

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

function recognitionError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('Речь не обнаружена') || message.includes('Речь слишком короткая')) {
    return 'Не удалось услышать фразу. Начните общение снова.';
  }
  return 'Не удалось распознать речь. Проверьте доступ к микрофону и попробуйте снова.';
}

export function useAndroidVoiceInput() {
  const current = useRef<Conversation | null>(null);
  const [model, setModel] = useState<ModelState>(() => modelReady
    ? { phase: 'ready' }
    : { phase: 'loading', message: 'Проверяем модель речи…' });
  const [modelRetry, setModelRetry] = useState(0);
  const [ttsModel, setTtsModel] = useState<ModelState>(hasSupertonicTts
    ? { phase: 'loading', message: 'Проверяем модель Supertonic…' }
    : { phase: 'ready' });
  const [ttsModelRetry, setTtsModelRetry] = useState(0);
  const [isActive, setActive] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>({ phase: 'idle' });
  const [transcript, setTranscript] = useState('');
  const [reply, setReply] = useState('');
  const [ttsChoice, setTtsChoice] = useState<TtsChoice>('system');

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

  useEffect(() => {
    if (!hasSupertonicTts) return;
    let observing = true;
    setTtsModel({ phase: 'loading', message: 'Проверяем модель Supertonic…' });
    void prefetchSupertonicModel(({ receivedBytes, totalBytes }) => {
      if (!observing) return;
      const mib = 1024 * 1024;
      setTtsModel({
        phase: 'loading',
        message: `Скачиваем Supertonic… ${Math.floor(receivedBytes / mib)} из ${Math.ceil(totalBytes / mib)} МиБ`,
        progress: totalBytes > 0 ? receivedBytes / totalBytes : undefined,
      });
    }).then(() => {
      if (observing) setTtsModel({ phase: 'ready' });
    }).catch(() => {
      if (observing) setTtsModel({
        phase: 'error',
        message: 'Не удалось подготовить Supertonic. Проверьте интернет и свободное место или выберите системный голос.',
      });
    });
    return () => { observing = false; };
  }, [ttsModelRetry]);

  const end = useCallback(() => {
    const session = current.current;
    if (!session || session.cancelled) return;

    cancelConversation(session);
    setActive(false);
    setFeedback({ phase: 'ending', message: 'Завершаем разговор…' });
  }, []);

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

  const start = async () => {
    if (!speech || !modelReady || current.current) return;
    if (voiceInUse) {
      setFeedback({ phase: 'error', message: 'Предыдущий разговор ещё завершается. Попробуйте снова.' });
      return;
    }

    const session: Conversation = {
      cancelled: false,
      requestingPermission: true,
      stopFailed: false,
    };
    current.current = session;
    voiceInUse = true;
    setActive(true);
    setFeedback({ phase: 'preparing', message: 'Готовим микрофон…' });

    let next: Feedback = { phase: 'idle' };
    let stage: 'permission' | 'tts' | 'recognition' = 'permission';
    let tts: TtsEngine | null = null;
    const useSupertonic = ttsChoice === 'supertonic';

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
      if (useSupertonic) {
        setFeedback({ phase: 'preparing', message: 'Проверяем модель Supertonic…' });
        tts = loadSupertonicTts(({ receivedBytes, totalBytes }) => {
          if (!session.cancelled) {
            const mib = 1024 * 1024;
            const message = receivedBytes >= totalBytes
              ? 'Загружаем модель Supertonic в память…'
              : `Скачиваем Supertonic… ${Math.floor(receivedBytes / mib)} из ${Math.ceil(totalBytes / mib)} МиБ`;
            setFeedback({ phase: 'preparing', message });
          }
        });
        session.preparingTts = tts;
      } else {
        if (hasAndroidTts) setFeedback({ phase: 'preparing', message: 'Готовим системный голос…' });
        tts = await loadAndroidTts();
      }
      if (session.cancelled) return;
      await tts?.initialize();
      session.preparingTts = undefined;
      const replies = mockConversationService.createSession();

      while (!session.cancelled) {
        stage = 'recognition';
        const turn: ListenTurn = {
          phase: 'preparing',
          nativeReady: false,
          cancelSent: false,
          command: Promise.resolve(),
        };
        session.turn = turn;

        const update = (phase: VoicePhase, message: string) => {
          turn.phase = phase;
          setFeedback({ phase, message });
        };
        update('preparing', 'Готовим микрофон…');

        const unsubscribe = addNaslukhProgressListener(({ phase, message }) => {
          if (phase === 'listen') turn.nativeReady = true;
          else if (phase !== 'asr' || !turn.nativeReady) return;
          if (session.cancelled) {
            cancelListening(session);
            return;
          }
          if (phase === 'asr' && turn.phase !== 'recognizing') {
            update('recognizing', 'Распознаём фразу…');
          } else if (phase === 'listen') {
            if (turn.phase === 'preparing') update('listening', 'Говорите. Пауза в 2,5 секунды завершит фразу.');
            if (turn.phase === 'listening' && message === 'Речь обнаружена') {
              update('user-speaking', 'Слушаем…');
            }
          }
        });

        let text: string;
        try {
          text = (await speech.listenOnce({
            language: 'ru',
            vadThreshold: 0.5,
            vadMinSilenceSec: 2.5,
          })).text.trim();
        } finally {
          unsubscribe();
          turn.nativeReady = false;
          await turn.command;
          session.turn = undefined;
        }

        if (session.cancelled) return;
        if (!text) {
          next = { phase: 'error', message: 'Фраза не распознана. Начните общение снова.' };
          return;
        }

        const answer = replies.replyTo(text);
        setTranscript(text);
        setReply(answer);

        if (!tts) continue;

        stage = 'tts';
        setFeedback({ phase: 'speaking', message: 'Озвучиваем ответ…' });
        try {
          // Naslukh releases AudioRecord before listenOnce settles.
          const playback = await tts.speak({ text: answer, locale: 'ru-RU' });
          session.playback = playback;
          if (session.cancelled) stopPlayback(session);

          const result = await playback.finished;
          if (!session.cancelled && result === 'stopped') {
            throw new Error('Android TTS playback was interrupted');
          }
        } catch (error) {
          stopPlayback(session);
          throw error;
        } finally {
          await session.playbackStop;
          session.playback = undefined;
          session.playbackStop = undefined;
        }
      }
    } catch (error) {
      const messages = {
        permission: 'Не удалось получить доступ к микрофону.',
        tts: useSupertonic
          ? 'Supertonic недоступен. Проверьте подключение и свободное место или выберите системный голос.'
          : 'Не удалось озвучить ответ. Проверьте русский голос в настройках синтеза речи Android.',
        recognition: recognitionError(error),
      };
      next = {
        phase: 'error',
        message: messages[stage],
      };
    } finally {
      session.preparingTts = undefined;
      await session.preparationStop;
      if (useSupertonic && tts) {
        try {
          await tts.dispose();
        } catch {
          session.stopFailed = true;
        }
      }
      voiceInUse = false;
      if (current.current === session) {
        current.current = null;
        setActive(false);
        if (session.stopFailed) {
          setFeedback({ phase: 'error', message: 'Не удалось полностью остановить звук. Попробуйте снова.' });
        } else {
          setFeedback(session.cancelled ? { phase: 'idle' } : next);
        }
      }
    }
  };

  const stop = () => {
    const session = current.current;
    const turn = session?.turn;
    if (!speech || !session || session.cancelled || !turn?.nativeReady) return;
    const phase = turn.phase;
    if (phase !== 'listening' && phase !== 'user-speaking') return;

    turn.phase = 'stopping';
    setFeedback({ phase: 'stopping', message: 'Завершаем фразу…' });
    turn.command = speech.stopListenOnce().catch(() => {
      if (!turn.nativeReady || session.cancelled || turn.phase !== 'stopping') return;
      turn.phase = phase;
      setFeedback({ phase, message: 'Не удалось завершить фразу. Попробуйте ещё раз.' });
    });
  };

  const { phase, message } = feedback;
  const status: ConversationStatus = phase === 'ending' || phase === 'stopping' ? 'recognizing' : phase;
  const retryModel = () => setModelRetry((value) => value + 1);
  const retryTtsModel = () => setTtsModelRetry((value) => value + 1);
  const selectTts = (choice: TtsChoice) => {
    if (!current.current && (choice === 'system' || hasSupertonicTts)) {
      setTtsChoice(choice);
      setFeedback({ phase: 'idle' });
    }
  };

  return {
    supported: speech !== null,
    hasTts: ttsChoice === 'supertonic' ? hasSupertonicTts : hasAndroidTts,
    hasSupertonicTts,
    ttsChoice,
    selectTts,
    model,
    retryModel,
    ttsModel,
    retryTtsModel,
    isActive,
    phase,
    status,
    message,
    transcript,
    reply,
    start,
    stop,
    end,
  };
}
