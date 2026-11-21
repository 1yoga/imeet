import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text } from 'react-native';

import { colors, typography } from '@/theme/tokens';

/** Строка с переключателем из макета: дорожка слева, подпись справа. */
export function ToggleRow({ label, value, onChange, disabled = false, last = false }: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  last?: boolean;
}) {
  const progress = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(progress, { duration: 160, easing: Easing.out(Easing.quad), toValue: value ? 1 : 0, useNativeDriver: false }).start();
  }, [progress, value]);

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={[styles.row, !last && styles.separator, disabled && styles.disabled]}
    >
      <Animated.View
        style={[styles.track, {
          backgroundColor: progress.interpolate({ inputRange: [0, 1], outputRange: ['#D6D6D6', '#7B6CFF'] }),
        }]}
      >
        <Animated.View
          style={[styles.knob, { transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 22] }) }] }]}
        />
      </Animated.View>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', flexDirection: 'row', gap: 16, minHeight: 52, paddingHorizontal: 24 },
  separator: { borderBottomColor: 'rgba(255, 255, 255, 0.08)', borderBottomWidth: 1 },
  disabled: { opacity: 0.45 },
  track: { borderRadius: 12, height: 24, justifyContent: 'center', paddingHorizontal: 2, width: 46 },
  knob: { backgroundColor: '#262428', borderRadius: 10, height: 20, width: 20 },
  label: { ...typography.subtitle, color: colors.white, flex: 1 },
});
