import { Image } from 'expo-image';
import { type ReactNode, useEffect, useRef } from 'react';
import { Animated, BackHandler, Easing, KeyboardAvoidingView, Pressable, StyleSheet, Text, View } from 'react-native';

import { BlurBackdrop } from '@/components/ui/BlurBackdrop';
import { colors, typography } from '@/theme/tokens';

const closeIcon = require('../../../assets/icons/ui/close.svg');

interface GlassDialogProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Кнопки внизу справа (Отмена / Сохранить / Выйти). */
  actions?: ReactNode;
}

/**
 * Стеклянный диалог из макета: заголовок, крестик, разделитель, содержимое и кнопки.
 * Рисуется поверх экрана (не Modal), чтобы под ним размывался сам экран; рендерить вне BlurTargetView.
 */
export function GlassDialog({ visible, title, onClose, children, actions }: GlassDialogProps) {
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    fade.setValue(0);
    Animated.timing(fade, { duration: 200, easing: Easing.out(Easing.quad), toValue: 1, useNativeDriver: true }).start();
    // Кнопка «Назад» Android закрывает диалог, а не экран.
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [fade, onClose, visible]);

  if (!visible) return null;
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: fade }]}>
      <BlurBackdrop />
      <KeyboardAvoidingView behavior="padding" style={styles.center}>
        <Pressable accessibilityLabel="Закрыть" onPress={onClose} style={StyleSheet.absoluteFill} />
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <Pressable accessibilityLabel="Закрыть" accessibilityRole="button" hitSlop={8} onPress={onClose} style={styles.close}>
              <Image contentFit="contain" source={closeIcon} style={styles.closeIcon} />
            </Pressable>
          </View>
          <View style={styles.divider} />
          <View style={styles.body}>{children}</View>
          {actions && <View style={styles.actions}>{actions}</View>}
        </View>
      </KeyboardAvoidingView>
    </Animated.View>
  );
}

export function DialogButton({ label, onPress, kind = 'primary', disabled = false }: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'outline' | 'danger';
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, styles[kind], (pressed || disabled) && styles.dim]}
    >
      <Text style={[styles.buttonText, kind === 'outline' && styles.outlineText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
  card: {
    backgroundColor: 'rgba(52, 47, 49, 0.82)',
    borderColor: 'rgba(255, 255, 255, 0.16)',
    borderRadius: 30,
    borderWidth: 1,
    maxWidth: 380,
    overflow: 'hidden',
    width: '100%',
  },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  title: { ...typography.title, color: colors.white, fontSize: 24, lineHeight: 30 },
  close: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 12,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  closeIcon: { height: 12, width: 12 },
  divider: { backgroundColor: 'rgba(255, 255, 255, 0.18)', height: 1 },
  body: { paddingBottom: 4, paddingTop: 4 },
  actions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end', paddingBottom: 16, paddingHorizontal: 16, paddingTop: 12 },
  button: { alignItems: 'center', borderRadius: 18, height: 36, justifyContent: 'center', paddingHorizontal: 16 },
  primary: { backgroundColor: '#7B6CFF' },
  danger: { backgroundColor: '#C42227' },
  outline: { borderColor: 'rgba(255, 255, 255, 0.55)', borderWidth: 1 },
  dim: { opacity: 0.6 },
  buttonText: { ...typography.button, color: colors.white, fontSize: 15, fontWeight: '500' },
  outlineText: { color: 'rgba(255, 255, 255, 0.75)' },
});
