import { useEffect, useMemo } from 'react';
import { PixelRatio, StyleSheet, View } from 'react-native';
import { Canvas, Fill, Shader, Skia } from '@shopify/react-native-skia';
import {
  Easing,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { layerSeeds, waveFormants, waveMotion, waveShaderSource } from '@/components/ai-conversation/wave/waveShader';
import { VoiceWaveImage, type VoiceWaveProps } from '@/components/ai-conversation/VoiceWaveImage';

// Компилируется один раз на запуск; null — драйвер не принял шейдер, тогда показываем картинку.
const effect = Skia.RuntimeEffect.Make(waveShaderSource);
if (!effect && __DEV__) console.warn('[VoiceWave] шейдер волны не скомпилировался, показываю картинку');

const stateEase = { duration: 450, easing: Easing.out(Easing.cubic) };
// Громкость сглаживается в каждом кадре (экспоненциально), а не скачками по 15 обновлениям в секунду:
// подъём ~0,18 с, спад ~0,5 с — волна плавно «вдыхает» на голос и не дрожит.
const ATTACK_SEC = 0.18;
const RELEASE_SEC = 0.5;

export function VoiceWave(props: VoiceWaveProps) {
  if (!effect) return <VoiceWaveImage {...props} />;
  return <ShaderWave {...props} />;
}

function ShaderWave({ active = true, height, left, level = 0, status, top, width }: VoiceWaveProps) {
  const motion = waveMotion[status];
  const px = useMemo(() => 1 / PixelRatio.get(), []);

  const time = useSharedValue(0);
  const speed = useSharedValue(motion.speed);
  const energy = useSharedValue(motion.energy);
  const think = useSharedValue(motion.think);
  const speak = useSharedValue(motion.speak);
  const dim = useSharedValue(motion.dim);
  const voice = useSharedValue(0);
  const heardTarget = useSharedValue(0);

  // Время течёт в UI-потоке со скоростью состояния: смена скорости не даёт рывка фазы.
  const clock = useFrameCallback((frame) => {
    const dt = Math.min(frame.timeSincePreviousFrame ?? 16, 50) / 1000;
    time.value = (time.value + dt * speed.value) % 3600;
    const target = heardTarget.value;
    const tau = target > voice.value ? ATTACK_SEC : RELEASE_SEC;
    voice.value += (target - voice.value) * (1 - Math.exp(-dt / tau));
  }, false);

  useEffect(() => {
    clock.setActive(active);
    return () => clock.setActive(false);
  }, [active, clock]);

  useEffect(() => {
    speed.value = withTiming(motion.speed, stateEase);
    energy.value = withTiming(motion.energy, stateEase);
    think.value = withTiming(motion.think, stateEase);
    speak.value = withTiming(motion.speak, stateEase);
    dim.value = withTiming(motion.dim, stateEase);
  }, [dim, energy, motion, speak, speed, think]);

  const heard = motion.hearsUser ? Math.min(1, Math.max(0, level)) : 0;
  useEffect(() => {
    heardTarget.value = heard;
  }, [heard, heardTarget]);

  const uniforms = useDerivedValue(() => {
    const t = time.value;
    const front = waveFormants(t, layerSeeds.front, voice.value, speak.value);
    const echo1 = waveFormants(t, layerSeeds.echo1, voice.value, speak.value);
    const echo2 = waveFormants(t, layerSeeds.echo2, voice.value, speak.value);
    return {
      uRes: [width, height],
      uPx: px,
      uTime: t,
      uEnergy: energy.value,
      uLevel: voice.value,
      uSpeak: speak.value,
      uThink: think.value,
      uDim: dim.value,
      uF0: front[0], uF1: front[1], uF2: front[2], uF3: front[3], uF4: front[4],
      uG0: echo1[0], uG1: echo1[1], uG2: echo1[2], uG3: echo1[3], uG4: echo1[4],
      uH0: echo2[0], uH1: echo2[1], uH2: echo2[2], uH3: echo2[3], uH4: echo2[4],
    };
  });

  return (
    <View pointerEvents="none" style={[styles.container, { height, left, top, width }]}>
      <Canvas style={{ height, width }}>
        <Fill>
          <Shader source={effect!} uniforms={uniforms} />
        </Fill>
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
  },
});
