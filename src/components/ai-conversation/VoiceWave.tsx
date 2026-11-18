import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet } from 'react-native';
import { Image } from 'expo-image';

import type { ConversationStatus } from '@/features/conversation/types';

interface VoiceWaveProps {
  height: number;
  left: number;
  status: ConversationStatus;
  top: number;
  width: number;
}

const motion = {
  idle: { strength: 0.045, opacity: 0.92 },
  preparing: { strength: 0.055, opacity: 0.78 },
  listening: { strength: 0.13, opacity: 1 },
  'user-speaking': { strength: 0.25, opacity: 1 },
  recognizing: { strength: 0.065, opacity: 0.85 },
  thinking: { strength: 0.065, opacity: 0.85 },
  speaking: { strength: 0.19, opacity: 0.94 },
  error: { strength: 0.03, opacity: 0.58 },
} satisfies Record<ConversationStatus, { strength: number; opacity: number }>;

const animationOptions = {
  isInteraction: false,
  useNativeDriver: Platform.OS !== 'web',
};

export function VoiceWave({ height, left, status, top, width }: VoiceWaveProps) {
  const phase = useRef(new Animated.Value(0)).current;
  const strength = useRef(new Animated.Value(motion.idle.strength)).current;
  const opacity = useRef(new Animated.Value(motion.idle.opacity)).current;
  const scaleY = useMemo(() => {
    const pulse = phase.interpolate({
      inputRange: [0, 0.08, 0.18, 0.27, 0.37, 0.46, 0.56, 0.65, 0.75, 0.84, 0.93, 1],
      outputRange: [0.22, 0.29, 0.62, 0.49, 0.27, 0.43, 0.86, 0.62, 0.32, 0.42, 0.28, 0.22],
    });
    return Animated.add(1, Animated.multiply(strength, pulse));
  }, [phase, strength]);

  useEffect(() => {
    // Keep the rhythm running while conversation states change.
    const animation = Animated.loop(
      Animated.timing(phase, {
        ...animationOptions,
        duration: 2800,
        easing: Easing.linear,
        toValue: 1,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [phase]);

  useEffect(() => {
    const target = motion[status];
    const transition = {
      ...animationOptions,
      duration: 170,
      easing: Easing.out(Easing.cubic),
    };
    const animation = Animated.parallel([
      Animated.timing(strength, { ...transition, toValue: target.strength }),
      Animated.timing(opacity, { ...transition, toValue: target.opacity }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [opacity, status, strength]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.container, { height, left, opacity, top, transform: [{ scaleY }], width }]}
    >
      <Image
        contentFit="fill"
        source={require('../../../assets/figma/voice-wave.png')}
        style={{ height, width }}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
  },
});
