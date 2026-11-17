import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef } from 'react';
import { StatusBar, StyleSheet, Text, View } from 'react-native';

import { BottomTabBar } from '@/components/ai-conversation/BottomTabBar';
import { ConversationButton } from '@/components/ai-conversation/ConversationButton';
import { InfoBanner } from '@/components/ai-conversation/InfoBanner';
import { VoiceWave } from '@/components/ai-conversation/VoiceWave';
import type { ConversationStatus } from '@/features/conversation/types';
import { useAppStore } from '@/store/app-store';
import { colors, typography } from '@/theme/tokens';

const busyStatuses: ConversationStatus[] = [
  'preparing',
  'listening',
  'recognizing',
  'thinking',
  'speaking',
];

export function AIConversationScreen() {
  const status = useAppStore((state) => state.conversationStatus);
  const activeTab = useAppStore((state) => state.activeTab);
  const isInfoVisible = useAppStore((state) => state.isInfoVisible);
  const setStatus = useAppStore((state) => state.setConversationStatus);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const dismissInfo = useAppStore((state) => state.dismissInfo);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    return () => {
      timers.current.forEach(clearTimeout);
    };
  }, []);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const runMockFlow = (flow: ConversationStatus[]) => {
    clearTimers();
    flow.forEach((nextStatus, index) => {
      const timer = setTimeout(
        () => setStatus(nextStatus),
        index === 0 ? 0 : index * 650,
      );
      timers.current.push(timer);
    });
  };

  const handleListen = () => {
    if (busyStatuses.includes(status)) {
      clearTimers();
      setStatus('idle');
      return;
    }

    runMockFlow([
      'preparing',
      'listening',
      'recognizing',
      'thinking',
      'speaking',
      'idle',
    ]);
  };

  const handleSpeak = () => {
    if (busyStatuses.includes(status)) {
      clearTimers();
      setStatus('idle');
      return;
    }

    runMockFlow(['preparing', 'speaking', 'idle']);
  };

  const handleMockError = () => {
    clearTimers();
    setStatus('error');
    timers.current.push(setTimeout(() => setStatus('idle'), 1400));
  };

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" />
      <LinearGradient
        colors={[colors.backgroundTop, colors.backgroundBottom]}
        end={{ x: 0.5, y: 1 }}
        start={{ x: 0.5, y: 0 }}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.textBlock}>
        <Text style={styles.title}>Добрый день, Александр</Text>
        <Text style={styles.subtitle}>
          Я помогу вам найти: любовь, друзей,{`\n`}
          или просто хорошую компанию для похода{`\n`}
          на выставку или в кино.
        </Text>
      </View>

      <VoiceWave status={status} />

      {isInfoVisible && <InfoBanner onDismiss={dismissInfo} />}

      <View style={styles.actions}>
        <ConversationButton
          iconSource={require('../../../assets/figma/no-sound.svg')}
          label="Не могу слушать"
          onPress={handleListen}
        />
        <ConversationButton
          accessibilityHint="Нажмите и удерживайте для проверки состояния ошибки"
          iconSource={require('../../../assets/figma/no-microphone.svg')}
          label="Не могу говорить"
          onLongPress={handleMockError}
          onPress={handleSpeak}
        />
      </View>

      <BottomTabBar activeTab={activeTab} onTabChange={setActiveTab} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.backgroundTop,
    flex: 1,
    overflow: 'hidden',
  },
  textBlock: {
    left: 16,
    position: 'absolute',
    top: 70,
    width: 380,
  },
  title: {
    color: colors.white,
    fontSize: typography.title.fontSize,
    fontWeight: typography.title.fontWeight,
    lineHeight: typography.title.lineHeight,
  },
  subtitle: {
    color: colors.subtitle,
    fontSize: typography.subtitle.fontSize,
    fontWeight: typography.subtitle.fontWeight,
    lineHeight: typography.subtitle.lineHeight,
    marginTop: 4,
  },
  actions: {
    gap: 8,
    left: 16,
    position: 'absolute',
    top: 632,
    width: 380,
  },
});
