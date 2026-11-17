import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import { Image } from 'expo-image';

import type { ConversationStatus } from '@/features/conversation/types';

interface VoiceWaveProps {
  status: ConversationStatus;
}

export function VoiceWave({ status }: VoiceWaveProps) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    pulse.stopAnimation();
    pulse.setValue(0);

    const duration = status === 'speaking' || status === 'listening' ? 520 : 1200;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();
    return () => animation.stop();
  }, [pulse, status]);

  const amplitude =
    status === 'speaking'
      ? 1.08
      : status === 'listening'
        ? 1.05
        : status === 'recognizing' || status === 'thinking'
          ? 1.035
          : status === 'error'
            ? 0.96
            : 1.02;

  const scaleY = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, amplitude],
  });

  const opacity = status === 'error' ? 0.58 : status === 'preparing' ? 0.72 : 1;

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.container, { opacity, transform: [{ scaleY }] }]}
    >
      <Image
        contentFit="fill"
        source={require('../../../assets/figma/voice-wave.png')}
        style={styles.image}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 222,
    left: -103,
    position: 'absolute',
    top: 294,
    width: 605,
  },
  image: {
    height: 222,
    width: 605,
  },
});
