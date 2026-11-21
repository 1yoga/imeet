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

/**
 * Слушать звук на выходе (голос агента). Возвращает функцию отписки;
 * если устройство не даёт снимать общий выход — null.
 */
export function listenOutputLevel(onLevel: (value: OutputLevel) => void): (() => void) | null {
  if (!native) return null;
  let started = false;
  try {
    started = native.start();
  } catch {
    started = false;
  }
  if (!started) return null;
  const subscription = native.addListener('onOutputLevel', onLevel);
  return () => {
    subscription.remove();
    try {
      native.stop();
    } catch {
      // уже остановлен
    }
  };
}
