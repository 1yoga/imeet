import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import type { TtsEngine } from './contracts';

interface ModelProgress {
  receivedBytes: number;
  totalBytes: number;
}

interface SupertonicModule {
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

export function loadSupertonicTts(onProgress: (progress: ModelProgress) => void): TtsEngine {
  if (!native) throw new Error('Установите Android-сборку iMeet с модулем Supertonic');
  const module = native;

  return {
    id: 'supertonic-3-int8',
    async initialize() {
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
