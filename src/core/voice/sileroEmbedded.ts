import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

/** Встроенный голос Silero: модели ONNX лежат в APK, синтез на телефоне без RuVoice (modules/imeet-voice). */
type SileroStatus = { bundled: boolean; loaded: boolean; loadMs: number };
export type SileroStart = { requestId: number; firstFrameMs: number; synthMs: number; audioMs: number; accented: string };

interface SileroModule {
  status(): Promise<SileroStatus>;
  load(): Promise<{ loadMs: number; speakers: string[] }>;
  speak(text: string, speaker: string, requestId: number): Promise<'completed' | 'stopped'>;
  stop(): Promise<void>;
  addListener(event: 'onSileroStart', listener: (event: SileroStart) => void): { remove(): void };
}

const native = Platform.OS === 'android' ? requireOptionalNativeModule<SileroModule>('IMeetSilero') : null;

export const hasEmbeddedSilero = native !== null;

let nextRequestId = 1;

export async function embeddedSileroStatus(): Promise<SileroStatus> {
  if (!native) return { bundled: false, loaded: false, loadMs: 0 };
  return native.status();
}

export async function loadEmbeddedSilero() {
  if (!native) throw new Error('Нужна новая Android-сборка iMeet');
  return native.load();
}

/** Озвучить реплику; onStart приходит, когда звук пошёл (с замерами синтеза). */
export async function playEmbeddedSilero(text: string, speaker: string, onStart: (event: SileroStart) => void) {
  if (!native) throw new Error('Нужна новая Android-сборка iMeet');
  const requestId = nextRequestId++;
  const subscription = native.addListener('onSileroStart', (event) => {
    if (event.requestId === requestId) onStart(event);
  });
  try {
    return await native.speak(text, speaker, requestId);
  } finally {
    subscription.remove();
  }
}

export async function stopEmbeddedSilero() {
  await native?.stop();
}
