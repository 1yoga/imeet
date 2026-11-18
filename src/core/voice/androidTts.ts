import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import type { TtsEngine } from './contracts';

export const hasAndroidTts = Platform.OS === 'android' && Boolean(requireOptionalNativeModule('ExpoSpeech'));

export async function loadAndroidTts(): Promise<TtsEngine | null> {
  // The existing development APK can load this bundle without the new native module.
  if (!hasAndroidTts) return null;

  const speech = await import('expo-speech');
  let russianVoice: string | undefined;
  const stop = async () => {
    await speech.stop();
    if (await speech.isSpeakingAsync()) {
      throw new Error('Android TTS is still speaking after stop');
    }
  };

  return {
    id: 'android-system',
    async initialize() {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const voices = await Promise.race([
          speech.getAvailableVoicesAsync(),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error('Android TTS initialization timed out')), 10_000);
          }),
        ]);
        const russian = voices.filter(({ language }) => /^ru(?:-|$)/i.test(language));
        const voice = russian.find(({ identifier }) => identifier.endsWith('-local')) ?? russian[0];
        if (!voice) {
          throw new Error('No Russian Android TTS voice is available');
        }
        russianVoice = voice.identifier;
        // Flush any playback left over from a failed stop before a new session opens the mic.
        await stop();
      } finally {
        clearTimeout(timeout);
      }
    },
    async speak(request) {
      let complete!: (result: 'completed' | 'stopped') => void;
      let fail!: (error: Error) => void;
      const finished = new Promise<'completed' | 'stopped'>((resolve, reject) => {
        complete = resolve;
        fail = reject;
      });
      // Some Android engines can fail without a terminal utterance callback.
      const timeout = setTimeout(() => fail(new Error('Android TTS playback timed out')), 25_000);
      const settle = (result: 'completed' | 'stopped') => {
        clearTimeout(timeout);
        complete(result);
      };
      const onError = (error: unknown) => {
        clearTimeout(timeout);
        fail(error instanceof Error ? error : new Error('Android TTS playback failed'));
      };

      try {
        speech.speak(request.text, {
          // Expo Speech on Android expects a language code here, even for regional locales.
          language: request.locale?.split('-')[0] ?? 'ru',
          rate: request.speed,
          voice: request.voice ?? russianVoice,
          onDone: () => settle('completed'),
          onStopped: () => settle('stopped'),
          onError,
        });
      } catch (error) {
        onError(error);
      }

      return {
        finished,
        async stop() {
          await stop();
          settle('stopped');
        },
      };
    },
    stop,
    dispose: stop,
  };
}
