import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import type { TtsEngine } from './contracts';

type VoiceInspection = { available: boolean; voiceName: string; reason: string };
type SpeechStart = { requestId: number; firstFrameMs: number };

interface DeviceTtsModule {
  inspect(enginePackage: string, voiceQuery: string): Promise<VoiceInspection>;
  speak(enginePackage: string, voiceQuery: string, text: string, requestId: number): Promise<'completed' | 'stopped'>;
  stop(): Promise<void>;
  addListener(event: 'onSpeechStart', listener: (event: SpeechStart) => void): { remove(): void };
}

const native = Platform.OS === 'android'
  ? requireOptionalNativeModule<DeviceTtsModule>('IMeetDeviceTts')
  : null;

export const hasDeviceTts = native !== null;

let nextRequestId = 1;

export function newDeviceRequestId() {
  return nextRequestId++;
}

export async function inspectDeviceVoice(enginePackage: string, voiceQuery: string) {
  if (!native) return { available: false, voiceName: '', reason: 'Требуется новая Android-сборка iMeet' };
  return native.inspect(enginePackage, voiceQuery);
}

export async function playDeviceVoice(
  enginePackage: string,
  voiceQuery: string,
  text: string,
  requestId: number,
  onStart: (firstFrameMs: number) => void,
) {
  if (!native) throw new Error('Модуль Android TTS отсутствует');
  const subscription = native.addListener('onSpeechStart', (event) => {
    if (event.requestId === requestId) onStart(event.firstFrameMs);
  });
  try {
    return await native.speak(enginePackage, voiceQuery, text, requestId);
  } finally {
    subscription.remove();
  }
}

export async function stopDeviceVoice() {
  await native?.stop();
}

/** Внешний Android TTS-движок (RuVoice) с конкретным голосом как TtsEngine для разговора. */
export function createDeviceTtsEngine(enginePackage: string, voiceQuery: string): TtsEngine {
  return {
    id: `device:${enginePackage}:${voiceQuery}`,
    async initialize() {
      const inspection = await inspectDeviceVoice(enginePackage, voiceQuery);
      if (!inspection.available) throw new Error(inspection.reason || 'Голос недоступен');
    },
    async speak({ text, onStart }) {
      const finished = playDeviceVoice(enginePackage, voiceQuery, text, newDeviceRequestId(), () => onStart?.());
      return { finished, stop: stopDeviceVoice };
    },
    stop: stopDeviceVoice,
    dispose: stopDeviceVoice,
  };
}
