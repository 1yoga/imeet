import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, typography } from '@/theme/tokens';

interface ConversationButtonProps {
  accessibilityHint?: string;
  disabled?: boolean;
  iconSource?: number;
  label: string;
  onLongPress?: () => void;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
}

export function ConversationButton({
  accessibilityHint,
  disabled = false,
  iconSource,
  label,
  onLongPress,
  onPress,
  variant = 'primary',
}: ConversationButtonProps) {
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onLongPress={onLongPress}
      onPress={onPress}
      style={({ pressed }) => [styles.pressable, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <LinearGradient
        colors={variant === 'secondary'
          ? [colors.glassFallbackTop, colors.glassFallbackBottom]
          : [colors.buttonHighlight, colors.primary]}
        end={{ x: 1, y: 0.5 }}
        start={{ x: 0, y: 0.5 }}
        style={styles.gradient}
      >
        {iconSource !== undefined && (
          <Image contentFit="contain" source={iconSource} style={styles.icon} />
        )}
        <Text style={styles.label}>{label}</Text>
        <View pointerEvents="none" style={styles.highlight} />
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    borderRadius: 100,
    height: 44,
    overflow: 'hidden',
    width: '100%',
  },
  pressed: {
    opacity: 0.82,
  },
  disabled: {
    opacity: 0.55,
  },
  gradient: {
    alignItems: 'center',
    borderRadius: 100,
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  icon: {
    height: 20,
    width: 20,
  },
  label: {
    fontFamily: typography.button.fontFamily,
    color: colors.white,
    fontSize: typography.button.fontSize,
    lineHeight: typography.button.lineHeight,
  },
  highlight: {
    borderColor: 'rgba(255, 255, 255, 0.36)',
    borderRadius: 100,
    borderTopWidth: 1,
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
});
