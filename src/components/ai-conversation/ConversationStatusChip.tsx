import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';

import type { ConversationStatus } from '@/features/conversation/types';
import type { Timings } from '@/features/conversation/useAndroidVoiceInput';
import { colors, typography } from '@/theme/tokens';

const mint = '#7CF5C8';
const muted = '#8A879E';

const states: Record<ConversationStatus, { label: string; dot: string; pulse: boolean }> = {
  idle: { label: 'Ожидание', dot: muted, pulse: false },
  preparing: { label: 'Готовлюсь', dot: colors.buttonHighlight, pulse: false },
  listening: { label: 'Слушаю', dot: mint, pulse: true },
  'user-speaking': { label: 'Слышу вас', dot: mint, pulse: true },
  recognizing: { label: 'Распознаю', dot: colors.buttonHighlight, pulse: true },
  thinking: { label: 'Готовлю ответ', dot: colors.buttonHighlight, pulse: true },
  speaking: { label: 'Отвечаю', dot: '#9B8FFF', pulse: true },
  error: { label: 'Пауза', dot: muted, pulse: false },
};

const seconds = (ms?: number) => (ms === undefined ? undefined : `${(ms / 1000).toFixed(1).replace('.', ',')} с`);

interface ConversationStatusChipProps {
  status: ConversationStatus;
  micOff: boolean;
  soundOff: boolean;
  timings: Timings;
  top: number;
}

export function ConversationStatusChip({ status, micOff, soundOff, timings, top }: ConversationStatusChipProps) {
  const state = micOff && status === 'idle'
    ? { label: 'Микрофон выключен', dot: muted, pulse: false }
    : states[status];
  const label = soundOff && status !== 'error' ? `${state.label} · без звука` : state.label;
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    pulse.setValue(1);
    if (!state.pulse) return;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.35, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(pulse, { toValue: 1, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [pulse, state.pulse]);

  const recognition = seconds(timings.recognitionMs);
  const reply = seconds(timings.replyMs);
  // Распознавание и время от конца фразы до первого звука ответа.
  const details = [recognition && `ASR ${recognition}`, reply && `голос ${reply}`].filter(Boolean).join(' · ');

  return (
    <View pointerEvents="none" style={[styles.container, { top }]}>
      <View accessibilityLabel={`Состояние: ${label}`} accessibilityLiveRegion="polite" style={styles.chip}>
        <Animated.View style={[styles.dot, { backgroundColor: state.dot, opacity: pulse }]} />
        <Text style={styles.label}>{label}</Text>
        {details ? <Text style={styles.details}>{details}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 6,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  chip: {
    alignItems: 'center',
    backgroundColor: 'rgba(7, 5, 30, 0.55)',
    borderColor: colors.glassBorder,
    borderRadius: 100,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  dot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  label: {
    ...typography.button,
    color: colors.white,
    fontSize: 13,
    lineHeight: 16,
  },
  details: {
    ...typography.tab,
    color: colors.subtitle,
    fontSize: 11,
    lineHeight: 14,
  },
});
