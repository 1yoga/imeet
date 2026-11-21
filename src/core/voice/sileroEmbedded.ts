import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import type { TtsEngine, TtsStreamRequest } from './contracts';

/** Встроенный голос Silero: модели ONNX лежат в APK, синтез на телефоне без RuVoice (modules/imeet-voice). */
type SileroStatus = { bundled: boolean; loaded: boolean; loadMs: number };
export type SileroStart = { requestId: number; firstFrameMs: number; synthMs: number; audioMs: number; accented: string; types: string };
/** Итог всей реплики: при делении на предложения — сумма по кускам; gapMs — тишина, когда следующий кусок не успел. */
export type SileroDone = {
  requestId: number; synthMs: number; audioMs: number; accented: string; types: string;
  chunks: number; gapMs: number; focusSymbols: number; homographs: boolean;
};

interface SileroModule {
  status(): Promise<SileroStatus>;
  load(): Promise<{ loadMs: number; speakers: string[] }>;
  download(): Promise<void>;
  speak(text: string, speaker: string, requestId: number, options: Record<string, unknown>): Promise<'completed' | 'stopped'>;
  stop(): Promise<void>;
  streamStart(requestId: number, speaker: string, options: Record<string, unknown>): Promise<void>;
  streamAppend(requestId: number, text: string): Promise<void>;
  streamFinish(requestId: number): Promise<'completed' | 'stopped'>;
  addListener(event: 'onSileroStart', listener: (event: SileroStart) => void): { remove(): void };
  addListener(event: 'onSileroDone', listener: (event: SileroDone) => void): { remove(): void };
  addListener(event: 'onSileroDownload', listener: (event: { fraction: number; message: string }) => void): { remove(): void };
}

const native = Platform.OS === 'android' ? requireOptionalNativeModule<SileroModule>('IMeetSilero') : null;

export const hasEmbeddedSilero = native !== null;

let nextRequestId = 1;

export async function embeddedSileroStatus(): Promise<SileroStatus> {
  if (!native) return { bundled: false, loaded: false, loadMs: 0 };
  return native.status();
}

let downloading: Promise<void> | undefined;
const downloadListeners = new Set<(fraction: number, message: string) => void>();

/**
 * Модели голоса (~130 МБ) не в APK: скачиваются один раз при первом запуске, с проверкой SHA-256.
 * Повторный вызов во время скачивания ждёт то же скачивание.
 */
export async function downloadEmbeddedSilero(onProgress?: (fraction: number, message: string) => void) {
  if (!native) throw new Error('Нужна новая Android-сборка iMeet');
  const mod = native;
  if (onProgress) downloadListeners.add(onProgress);
  downloading ??= (async () => {
    const subscription = mod.addListener('onSileroDownload', ({ fraction, message }) => {
      downloadListeners.forEach((listener) => listener(fraction, message));
    });
    try {
      await mod.download();
    } finally {
      subscription.remove();
      downloading = undefined;
    }
  })();
  try {
    await downloading;
  } finally {
    if (onProgress) downloadListeners.delete(onProgress);
  }
}

export async function loadEmbeddedSilero() {
  if (!native) throw new Error('Нужна новая Android-сборка iMeet');
  return native.load();
}

/** whole — целиком; sentences — по предложениям; phrases — по предложениям и запятым (как RuVoice). */
export type SileroSplit = 'whole' | 'sentences' | 'phrases';

/** Добавочная тишина после куска по типу границы, мс (как вкладка «Паузы» в RuVoice). */
export type SileroPauses = { sentence: number; comma: number; dash: number; paragraph: number };
export const ruVoicePauses: SileroPauses = { sentence: 0, comma: 100, dash: 150, paragraph: 300 };
export const noPauses: SileroPauses = { sentence: 0, comma: 0, dash: 0, paragraph: 0 };

type PlayOptions = {
  split?: SileroSplit;
  pauses?: SileroPauses;
  /** Высота голоса: 1 — как модель. RuVoice берёт системную высоту Android (у тебя ×0.86). */
  pitch?: number;
  /** Словари чтения RuVoice (ударения и подсказки омографов). */
  rules?: boolean;
  /** Сохранить звук в files/compare/<имя>.wav на телефоне. */
  recordName?: string;
  onStart?: (event: SileroStart) => void;
  onDone?: (event: SileroDone) => void;
};

/** Озвучить реплику; onStart — когда звук пошёл, onDone — когда синтезированы все куски. */
export async function playEmbeddedSilero(text: string, speaker: string, { split = 'whole', pauses = noPauses, pitch = 1, rules = true, recordName = '', onStart, onDone }: PlayOptions = {}) {
  if (!native) throw new Error('Нужна новая Android-сборка iMeet');
  const requestId = nextRequestId++;
  const started = native.addListener('onSileroStart', (event) => {
    if (event.requestId === requestId) onStart?.(event);
  });
  const done = native.addListener('onSileroDone', (event) => {
    if (event.requestId === requestId) onDone?.(event);
  });
  try {
    return await native.speak(text, speaker, requestId, {
      mode: split === 'phrases' ? 2 : split === 'sentences' ? 1 : 0,
      pauses,
      pitch,
      rules,
      recordName,
    });
  } finally {
    started.remove();
    done.remove();
  }
}

export async function stopEmbeddedSilero() {
  await native?.stop();
}

/** Настройки встроенного голоса по итогам сравнения с RuVoice: по фразам, словари, без доп. пауз, высота 1. */
export const embeddedDefaults = { split: 'phrases' as SileroSplit, pauses: noPauses, pitch: 1, rules: true };

/**
 * Порции для потока: первая — как только набралась фраза (до запятой/точки), чтобы звук начался рано;
 * дальше — целыми предложениями, чтобы омографы видели смысл.
 */
async function* phrasesFrom(chunks: AsyncIterable<string>) {
  let buffer = '';
  let first = true;
  for await (const piece of chunks) {
    buffer += piece;
    const boundary = first ? /^[\s\S]*?[,;:.!?…](?=\s)/u : /^[\s\S]*[.!?…](?=\s)/u;
    const match = buffer.match(boundary);
    if (match && match[0].replace(/[^\p{L}]/gu, '').length >= 2) {
      yield match[0];
      buffer = buffer.slice(match[0].length);
      first = false;
    }
  }
  if (buffer.trim()) yield buffer;
}

/** Встроенный Silero как движок озвучки разговора. */
export function createEmbeddedTtsEngine(speaker: string): TtsEngine {
  return {
    id: `embedded:${speaker}`,
    async initialize() {
      await loadEmbeddedSilero();
    },
    async speak({ text, onStart }) {
      const finished = playEmbeddedSilero(text, speaker, { ...embeddedDefaults, onStart: () => onStart?.() });
      return { finished, stop: stopEmbeddedSilero };
    },
    speakStream({ chunks, onStart }: TtsStreamRequest) {
      if (!native) throw new Error('Нужна новая Android-сборка iMeet');
      const mod = native;
      const requestId = nextRequestId++;
      let stopped = false;
      const started = mod.addListener('onSileroStart', (event) => {
        if (event.requestId === requestId) onStart?.();
      });
      const finished = (async () => {
        try {
          await mod.streamStart(requestId, speaker, { pauses: embeddedDefaults.pauses, pitch: embeddedDefaults.pitch, rules: embeddedDefaults.rules });
          for await (const phrase of phrasesFrom(chunks)) {
            if (stopped) break;
            await mod.streamAppend(requestId, phrase);
          }
          return await mod.streamFinish(requestId);
        } finally {
          started.remove();
        }
      })();
      return {
        finished,
        stop: async () => {
          stopped = true;
          await stopEmbeddedSilero();
        },
      };
    },
    stop: stopEmbeddedSilero,
    dispose: stopEmbeddedSilero,
  };
}
