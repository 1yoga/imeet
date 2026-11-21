import { useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet, Text, View } from 'react-native';

import { colors, typography } from '@/theme/tokens';

interface ConversationCaptionsProps {
  transcript: string;
  reply: string;
}

/** Последняя распознанная фраза и ответ — на месте подзаголовка, когда разговор начался. */
export function ConversationCaptions({ transcript, reply }: ConversationCaptionsProps) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    opacity.setValue(0);
    const animation = Animated.timing(opacity, { toValue: 1, duration: 260, useNativeDriver: Platform.OS !== 'web' });
    animation.start();
    return () => animation.stop();
  }, [opacity, transcript]);

  return (
    <Animated.View style={[styles.container, { opacity }]}>
      <View style={styles.row}>
        <Text style={styles.label}>Вы</Text>
        <Text accessibilityLiveRegion="polite" numberOfLines={2} selectable style={styles.transcript}>
          {transcript}
        </Text>
      </View>
      {reply ? (
        <View style={styles.row}>
          <Text style={[styles.label, styles.agentLabel]}>iMeet</Text>
          <Text numberOfLines={3} selectable style={styles.reply}>{reply}</Text>
        </View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },
  row: {
    gap: 2,
  },
  label: {
    ...typography.tab,
    color: colors.subtitle,
    fontSize: 11,
    letterSpacing: 0.6,
    lineHeight: 14,
    textTransform: 'uppercase',
  },
  agentLabel: {
    color: colors.buttonHighlight,
  },
  transcript: {
    ...typography.subtitle,
    color: colors.subtitle,
    fontSize: 15,
    lineHeight: 20,
  },
  reply: {
    ...typography.subtitle,
    color: colors.white,
    fontSize: 16,
    lineHeight: 22,
  },
});
