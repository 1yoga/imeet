import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export interface VoiceUsageSnapshot {
  appPssKb: number;
}

// Замер PSS живёт в нативном модуле modules/imeet-voice.
interface MetricsModule {
  snapshot(): Promise<VoiceUsageSnapshot>;
  log?(event: string, json: string): Promise<number>;
  logInfo?(): Promise<{ path: string; records: number }>;
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

/**
 * Записать замер в журнал телефона (voice-metrics.jsonl, одна строка JSON на событие).
 * Нативная часть сама добавит память процесса, время и устройство. Забрать: tools\pull-metrics.cmd.
 */
export async function logVoiceMetric(event: string, data: Record<string, unknown>): Promise<number | null> {
  if (!native?.log) return null;
  try {
    return await native.log(event, JSON.stringify(data));
  } catch {
    return null;
  }
}

export async function voiceMetricsLogInfo() {
  return native?.logInfo ? native.logInfo() : null;
}
