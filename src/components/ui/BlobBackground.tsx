import { Canvas, Fill, Shader, Skia } from '@shopify/react-native-skia';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useDerivedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated';

import { blobPositions, blobShaderSource } from './blobShader';

const effect = Skia.RuntimeEffect.Make(blobShaderSource);
if (!effect && __DEV__) console.warn('[BlobBackground] шейдер капель не скомпилировался');

export interface CardRect {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}

interface BlobBackgroundProps {
  width: number;
  height: number;
  /** Карточка поверх фона: под ней капли мягче, как сквозь матовое стекло. */
  card: CardRect;
  /** Экран виден — иначе анимация на паузе. */
  active: boolean;
}

/** Живой фон вкладки «Карточки симпатий»: глянцевые капли плывут за стеклянной карточкой. */
export function BlobBackground({ width, height, card, active }: BlobBackgroundProps) {
  const time = useSharedValue(0);
  const clock = useFrameCallback((frame) => {
    time.value = (time.value + Math.min(frame.timeSincePreviousFrame ?? 16, 50) / 1000) % 3600;
  }, false);

  useEffect(() => {
    clock.setActive(active);
    return () => clock.setActive(false);
  }, [active, clock]);

  const uniforms = useDerivedValue(() => {
    const blobs = blobPositions(time.value, height / width);
    return {
      uRes: [width, height],
      uTime: time.value,
      uB0: blobs[0], uB1: blobs[1], uB2: blobs[2], uB3: blobs[3], uB4: blobs[4], uB5: blobs[5],
      uCard: [card.x, card.y, card.width, card.height],
      uCardR: card.radius,
    };
  });

  if (!effect) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Canvas style={{ height, width }}>
        <Fill>
          <Shader source={effect} uniforms={uniforms} />
        </Fill>
      </Canvas>
    </View>
  );
}
