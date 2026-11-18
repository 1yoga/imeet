import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import type { TtsEngine } from './contracts';

interface ModelProgress {
  receivedBytes: number;
  totalBytes: number;
}

export interface PlaybackMetrics {
  requestId: number;
  synthesisMs: number;
  firstFrameMs: number;
}

export const supertonicVoices = [
  { name: 'F1', id: 0 }, { name: 'F2', id: 1 }, { name: 'F3', id: 2 },
  { name: 'F4', id: 3 }, { name: 'F5', id: 4 }, { name: 'M1', id: 5 },
  { name: 'M2', id: 6 }, { name: 'M3', id: 7 }, { name: 'M4', id: 8 },
  { name: 'M5', id: 9 },
] as const;

export type SupertonicVoiceName = (typeof supertonicVoices)[number]['name'];

interface SupertonicModule {
  prefetchModel(): Promise<void>;
  initialize(): Promise<void>;
  play(text: string, speed: number): Promise<'completed' | 'stopped'>;
  playVoice(text: string, speed: number, voiceId: number, requestId: number): Promise<'completed' | 'stopped'>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
  addListener(event: 'onModelProgress', listener: (progress: ModelProgress) => void): { remove(): void };
  addListener(event: 'onPlaybackMetrics', listener: (metrics: PlaybackMetrics) => void): { remove(): void };
}

const native = Platform.OS === 'android'
  ? requireOptionalNativeModule<SupertonicModule>('IMeetSupertonic')
  : null;

export const hasSupertonicTts = native !== null;

let modelCached = false;
let modelPrefetch: Promise<void> | undefined;

export function prefetchSupertonicModel(onProgress: (progress: ModelProgress) => void) {
  if (!native) return Promise.reject(new Error('Модуль Supertonic отсутствует в APK'));
  if (modelCached) return Promise.resolve();
  const module = native;
  const subscription = module.addListener('onModelProgress', onProgress);
  modelPrefetch ??= module.prefetchModel()
    .then(() => { modelCached = true; })
    .finally(() => { modelPrefetch = undefined; });
  return modelPrefetch.finally(() => subscription.remove());
}

export async function initializeSupertonicForLab(onProgress: (progress: ModelProgress) => void) {
  if (!native) throw new Error('Supertonic доступен только в Android APK с нативным модулем');
  await modelPrefetch;
  const subscription = native.addListener('onModelProgress', onProgress);
  try {
    await native.initialize();
  } finally {
    subscription.remove();
  }
}

export async function playSupertonicVoice(
  text: string,
  voice: SupertonicVoiceName,
  requestId: number,
  onMetrics: (metrics: PlaybackMetrics) => void,
) {
  if (!native) throw new Error('Supertonic недоступен');
  const voiceId = supertonicVoices.find(({ name }) => name === voice)?.id;
  if (voiceId === undefined) throw new Error('Неизвестный голос Supertonic');
  const subscription = native.addListener('onPlaybackMetrics', (metrics) => {
    if (metrics.requestId === requestId) onMetrics(metrics);
  });
  try {
    return await native.playVoice(text, 1, voiceId, requestId);
  } finally {
    subscription.remove();
  }
}

export async function stopSupertonicVoice() {
  await native?.stop();
}

export async function disposeSupertonicLab() {
  await native?.dispose();
}

export function loadSupertonicTts(onProgress: (progress: ModelProgress) => void): TtsEngine {
  if (!native) throw new Error('Установите Android-сборку iMeet с модулем Supertonic');
  const module = native;

  return {
    id: 'supertonic-3-int8',
    async initialize() {
      await modelPrefetch;
      const subscription = module.addListener('onModelProgress', onProgress);
      try {
        await module.initialize();
      } finally {
        subscription.remove();
      }
    },
    async speak({ text, speed = 1 }) {
      return {
        finished: module.play(text, speed),
        stop: () => module.stop(),
      };
    },
    stop: () => module.stop(),
    dispose: () => module.dispose(),
  };
}
