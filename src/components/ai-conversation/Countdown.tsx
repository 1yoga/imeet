import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet } from 'react-native';

import { BlurBackdrop } from '@/components/ui/BlurBackdrop';

/** Обратный отсчёт перед началом прослушивания (Figma 39:126, 48:283, 48:343). Тап — начать сразу. */
export function Countdown({ value, top, onSkip }: { value: number; top: number; onSkip: () => void }) {
  const appear = useRef(new Animated.Value(0)).current;
  const shade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(shade, { duration: 220, easing: Easing.out(Easing.quad), toValue: 1, useNativeDriver: true }).start();
  }, [shade]);

  useEffect(() => {
    appear.setValue(0);
    Animated.timing(appear, { duration: 380, easing: Easing.out(Easing.back(1.6)), toValue: 1, useNativeDriver: true }).start();
  }, [appear, value]);

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: shade }]}>
      <BlurBackdrop dim="rgba(6, 4, 24, 0.3)" intensity={90} />
      <Pressable accessibilityHint="Начать слушать сразу" accessibilityLabel={`Начинаю через ${value}`} onPress={onSkip} style={StyleSheet.absoluteFill}>
        <Animated.Text
          style={[styles.digit, {
            opacity: appear,
            top,
            transform: [{ scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
          }]}
        >
          {value}
        </Animated.Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  digit: {
    color: '#DCDAEE',
    fontFamily: 'sans-serif-medium',
    fontSize: 84,
    fontWeight: '600',
    left: 0,
    lineHeight: 96,
    position: 'absolute',
    right: 0,
    textAlign: 'center',
  },
});
