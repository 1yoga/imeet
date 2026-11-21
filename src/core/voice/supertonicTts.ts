import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import type { TtsEngine } from './contracts';

interface ModelProgress {
  receivedBytes: number;
  totalBytes: number;
}

export interface SupertonicDictionaryStatus {
  enabled: boolean;
  cachedBytes: number;
  totalBytes: number;
}

export interface PlaybackMetrics {
  requestId: number;
  synthesisMs: number;
  firstFrameMs: number;
  dictionaryMs: number;
  stressReplacements: number;
}

export interface VoiceUsageSnapshot {
  appPssKb: number;
  modelBytes: number;
}

export const supertonicVoices = [
  { name: 'F2', id: 1 }, { name: 'F5', id: 4 },
  { name: 'M1', id: 5 }, { name: 'M2', id: 6 },
] as const;

export type SupertonicVoiceName = (typeof supertonicVoices)[number]['name'];

interface SupertonicModule {
  snapshot(category: 'supertonic' | 'external'): Promise<VoiceUsageSnapshot>;
  prefetchModel(): Promise<void>;
  initialize(): Promise<void>;
  play(text: string, speed: number): Promise<'completed' | 'stopped'>;
  playVoice(text: string, speed: number, voiceId: number, requestId: number): Promise<'completed' | 'stopped'>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
  dictionaryStatus(): Promise<SupertonicDictionaryStatus>;
  setDictionaryEnabled(enabled: boolean): Promise<void>;
  addListener(event: 'onModelProgress', listener: (progress: ModelProgress) => void): { remove(): void };
  addListener(event: 'onDictionaryProgress', listener: (progress: ModelProgress) => void): { remove(): void };
  addListener(event: 'onPlaybackMetrics', listener: (metrics: PlaybackMetrics) => void): { remove(): void };
}

const native = Platform.OS === 'android'
  ? requireOptionalNativeModule<SupertonicModule>('IMeetSupertonic')
  : null;

export const hasSupertonicTts = native !== null;

export function snapshotVoiceUsage(category: 'supertonic' | 'external') {
  if (!native) return Promise.reject(new Error('Модуль замеров недоступен'));
  return native.snapshot(category);
}

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

export async function initializeSupertonicForLab(
  onProgress: (progress: ModelProgress) => void,
  onDictionaryProgress?: (progress: ModelProgress) => void,
) {
  if (!native) throw new Error('Supertonic доступен только в Android APK с нативным модулем');
  await modelPrefetch;
  const subscription = native.addListener('onModelProgress', onProgress);
  const dictionarySubscription = native.addListener('onDictionaryProgress', onDictionaryProgress ?? (() => {}));
  try {
    await native.initialize();
  } finally {
    subscription.remove();
    dictionarySubscription.remove();
  }
}

export async function getSupertonicDictionaryStatus() {
  if (!native) throw new Error('Supertonic недоступен');
  return native.dictionaryStatus();
}

export async function setSupertonicDictionaryEnabled(
  enabled: boolean,
  onProgress: (progress: ModelProgress) => void,
) {
  if (!native) throw new Error('Supertonic недоступен');
  const subscription = native.addListener('onDictionaryProgress', onProgress);
  try {
    await native.setDictionaryEnabled(enabled);
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
