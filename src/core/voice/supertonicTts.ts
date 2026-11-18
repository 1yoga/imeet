import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import type { TtsEngine } from './contracts';

interface ModelProgress {
  receivedBytes: number;
  totalBytes: number;
}

interface SupertonicModule {
  prefetchModel(): Promise<void>;
  initialize(): Promise<void>;
  play(text: string, speed: number): Promise<'completed' | 'stopped'>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
  addListener(event: 'onModelProgress', listener: (progress: ModelProgress) => void): { remove(): void };
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
