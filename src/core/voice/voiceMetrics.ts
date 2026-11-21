import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export interface VoiceUsageSnapshot {
  appPssKb: number;
}

// Замер PSS живёт в нативном модуле modules/imeet-voice.
interface MetricsModule {
  snapshot(): Promise<VoiceUsageSnapshot>;
}

const native = Platform.OS === 'android'
  ? requireOptionalNativeModule<MetricsModule>('IMeetVoiceMetrics')
  : null;

export const hasVoiceMetrics = native !== null;

/** PSS всего процесса iMeet после озвучки внешним или системным движком. */
export function snapshotAppMemory() {
  if (!native) return Promise.reject(new Error('Модуль замеров недоступен'));
  return native.snapshot();
}
