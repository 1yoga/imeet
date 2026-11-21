import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export interface VoiceUsageSnapshot {
  appPssKb: number;
  modelBytes: number;
}

// Замер PSS пока живёт в нативном модуле IMeetSupertonic (modules/imeet-supertonic).
interface MetricsModule {
  snapshot(category: 'supertonic' | 'external'): Promise<VoiceUsageSnapshot>;
}

const native = Platform.OS === 'android'
  ? requireOptionalNativeModule<MetricsModule>('IMeetSupertonic')
  : null;

export const hasVoiceMetrics = native !== null;

/** PSS всего процесса iMeet после озвучки внешним или системным движком. */
export function snapshotAppMemory() {
  if (!native) return Promise.reject(new Error('Модуль замеров недоступен'));
  return native.snapshot('external');
}
