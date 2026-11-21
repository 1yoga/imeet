import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

/** Громкость (0..1) и пять полос спектра (от низких к высоким) того, что звучит из динамика. */
export interface OutputLevel {
  level: number;
  bands: number[];
}

interface OutputLevelModule {
  start(): boolean;
  stop(): void;
  addListener(event: 'onOutputLevel', listener: (event: OutputLevel) => void): { remove(): void };
}

const native = Platform.OS === 'android'
  ? requireOptionalNativeModule<OutputLevelModule>('IMeetOutputLevel')
  : null;

interface SileroLevelModule {
  addListener(event: 'onSileroLevel', listener: (event: OutputLevel) => void): { remove(): void };
}

// Встроенный голос сам сообщает громкость того, что играет (по своим сэмплам) — точнее Visualizer.
const silero = Platform.OS === 'android'
  ? requireOptionalNativeModule<SileroLevelModule>('IMeetSilero')
  : null;

/**
 * Слушать звук на выходе (голос агента). Возвращает функцию отписки;
 * если устройство не даёт снимать общий выход — null.
 */
export function listenOutputLevel(onLevel: (value: OutputLevel) => void): (() => void) | null {
  let lastOwnAt = 0;
  const own = silero?.addListener('onSileroLevel', (value: OutputLevel) => {
    lastOwnAt = Date.now();
    onLevel(value);
  });
  // Системный выход (Visualizer) — для голоса, который играет не наш модуль (системный TTS).
  let started = false;
  if (native) {
    try {
      started = native.start();
    } catch {
      started = false;
    }
  }
  const subscription = started && native
    ? native.addListener('onOutputLevel', (value: OutputLevel) => {
      if (Date.now() - lastOwnAt > 300) onLevel(value);
    })
    : null;
  if (!own && !subscription) return null;
  return () => {
    own?.remove();
    subscription?.remove();
    if (started) {
      try {
        native?.stop();
      } catch {
        // уже остановлен
      }
    }
  };
}
