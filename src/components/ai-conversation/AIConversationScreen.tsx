import { LinearGradient } from 'expo-linear-gradient';
import { useKeepAwake } from 'expo-keep-awake';
import { router, type Href } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomTabBar } from '@/components/ai-conversation/BottomTabBar';
import { ConversationButton } from '@/components/ai-conversation/ConversationButton';
import { InfoBanner } from '@/components/ai-conversation/InfoBanner';
import { VoiceWave } from '@/components/ai-conversation/VoiceWave';
import { useAndroidVoiceInput } from '@/features/conversation/useAndroidVoiceInput';
import { useAppStore } from '@/store/app-store';
import { colors, layout, typography } from '@/theme/tokens';

const ttsChoices = [
  { value: 'system', label: 'Системный TTS' },
  { value: 'supertonic', label: 'Supertonic 3 · F1' },
] as const;

export function AIConversationScreen() {
  useKeepAwake();
  const voice = useAndroidVoiceInput();
  const canStartVoice = !voice.isActive && voice.model.phase === 'ready'
    && (voice.ttsChoice === 'system' || voice.ttsModel.phase === 'ready')
    && (voice.phase === 'idle' || voice.phase === 'error');
  const canStopVoice = voice.phase === 'listening' || voice.phase === 'user-speaking';
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scale = Math.min(
    1,
    width / layout.frameWidth,
    height / layout.frameHeight,
  );
  const contentWidth = Math.max(0, width - layout.horizontalPadding * 2);
  const titleTop = Math.max(layout.titleTop * scale, insets.top + 18 * scale);
  const tabBarHeight = 84;
  const spaceAboveTabs = height - insets.bottom - 24 * scale - tabBarHeight - 16 * scale;
  const actionsTop = Math.min(layout.actionsTop * scale, spaceAboveTabs - 96);
  const infoTop = actionsTop - 80;
  const waveTop = layout.waveTop * scale;
  const waveHeight = layout.waveHeight * scale;
  const waveBottom = waveTop + waveHeight;
  const statusTop = titleTop + (voice.hasSupertonicTts ? 142 : 112);
  const transcriptTop = waveBottom + 30;
  const waveWidth = layout.waveWidth * scale;
  const waveLeft =
    (width - layout.frameWidth * scale) / 2 + layout.waveLeft * scale;
  const activeTab = useAppStore((state) => state.activeTab);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const preparation = voice.model.phase !== 'ready' ? voice.model : voice.ttsModel;
  const retryPreparation = voice.model.phase === 'error'
    ? voice.retryModel
    : voice.ttsChoice === 'supertonic' && voice.ttsModel.phase === 'error'
      ? voice.retryTtsModel
      : undefined;
  const showModel = voice.supported && preparation.phase !== 'ready';
  const conversationHint = voice.hasTts
    ? 'Пробный разговор по-русски со сценарными ответами.'
    : 'Пробный разговор по-русски. В этой сборке ответы показываются текстом.';
  const canChangeTts = !voice.isActive && (voice.phase === 'idle' || voice.phase === 'error');

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <LinearGradient
        colors={[colors.backgroundTop, colors.backgroundBottom]}
        end={{ x: 0.5, y: 1 }}
        start={{ x: 0.5, y: 0 }}
        style={StyleSheet.absoluteFill}
      />

      <View style={[styles.textBlock, { top: titleTop, width: contentWidth }]}>
        <Text style={styles.title}>Добрый день, Александр</Text>
        <Text style={styles.subtitle}>
          {voice.supported
            ? conversationHint
            : 'Голосовой ввод доступен в приложении для Android.'}
        </Text>
        {voice.hasSupertonicTts && (
          <View accessibilityRole="radiogroup" accessibilityLabel="Движок озвучки" style={styles.ttsChoices}>
            {ttsChoices.map(({ value, label }) => {
              const selected = voice.ttsChoice === value;
              return (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected, disabled: !canChangeTts }}
                  disabled={!canChangeTts}
                  onPress={() => voice.selectTts(value)}
                  style={[styles.ttsChoice, selected && styles.ttsChoiceSelected]}
                >
                  <Text style={[styles.ttsLabel, selected && styles.ttsLabelSelected]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
        {canChangeTts && (
          <Pressable accessibilityRole="button" onPress={() => router.push('/voice-lab' as Href)} style={styles.voiceLabLink}>
            <Text style={styles.voiceLabLinkText}>Открыть Voice Lab →</Text>
          </Pressable>
        )}
      </View>

      <VoiceWave
        height={waveHeight}
        left={waveLeft}
        status={voice.status}
        top={waveTop}
        width={waveWidth}
      />

      {voice.supported && (voice.isActive || Boolean(voice.message)) && (
        <View style={[styles.voiceStatusBox, { top: statusTop, width: contentWidth, maxHeight: Math.max(0, waveTop - statusTop - 12) }]}>
          {voice.isActive && <Text style={styles.voiceStatus}>Разговор активен</Text>}
          {voice.message && <Text accessibilityLiveRegion="polite" numberOfLines={2} style={styles.voiceMessage}>{voice.message}</Text>}
        </View>
      )}

      {voice.supported && Boolean(voice.transcript || voice.reply) && (
        <ScrollView
          contentContainerStyle={styles.voiceFeedbackContent}
          style={[
            styles.voiceFeedback,
            {
              maxHeight: Math.max(0, actionsTop - transcriptTop - 12),
              top: transcriptTop,
              width: contentWidth,
            },
          ]}
        >
          {voice.transcript !== '' && (
            <View accessibilityLiveRegion="polite">
              <Text style={styles.voiceMessage}>Ваша фраза</Text>
              <Text selectable style={styles.transcript}>{voice.transcript}</Text>
            </View>
          )}
          {voice.reply !== '' && (
            <View>
              <Text style={styles.voiceMessage}>Ответ iMeet</Text>
              <Text selectable style={styles.transcript}>{voice.reply}</Text>
            </View>
          )}
        </ScrollView>
      )}

      {showModel && (
        <InfoBanner
          progress={preparation.phase === 'loading' ? preparation.progress : undefined}
          scale={scale}
          text={preparation.message}
          top={infoTop}
          width={contentWidth}
        />
      )}

      {voice.supported && (
        <View style={[styles.actions, { top: actionsTop, width: contentWidth }]}>
          {retryPreparation ? (
            <ConversationButton label="Повторить подготовку" onPress={retryPreparation} />
          ) : (
            <ConversationButton
              disabled={!canStartVoice && !canStopVoice}
              label={voice.isActive ? 'Закончить фразу' : 'Начать общение'}
              onPress={voice.isActive ? voice.stop : voice.start}
            />
          )}
          {voice.isActive && (
            <ConversationButton
              accessibilityHint="Незавершённая фраза будет отброшена"
              label="Завершить разговор"
              onPress={voice.end}
              variant="secondary"
            />
          )}
        </View>
      )}

      <BottomTabBar
        activeTab={activeTab}
        bottomInset={insets.bottom + 24 * scale}
        onTabChange={setActiveTab}
        scale={scale}
        width={contentWidth}
      />
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
  },
  title: {
    fontFamily: typography.title.fontFamily,
    color: colors.white,
    fontSize: typography.title.fontSize,
    fontWeight: typography.title.fontWeight,
    lineHeight: typography.title.lineHeight,
  },
  subtitle: {
    fontFamily: typography.subtitle.fontFamily,
    color: colors.subtitle,
    fontSize: typography.subtitle.fontSize,
    fontWeight: typography.subtitle.fontWeight,
    lineHeight: typography.subtitle.lineHeight,
    marginTop: 4,
  },
  ttsChoices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  voiceLabLink: {
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingVertical: 6,
  },
  voiceLabLinkText: {
    color: colors.buttonHighlight,
    fontSize: 14,
  },
  ttsChoice: {
    borderColor: colors.glassBorder,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  ttsChoiceSelected: {
    backgroundColor: colors.infoBackground,
    borderColor: colors.buttonHighlight,
  },
  ttsLabel: {
    ...typography.button,
    color: colors.subtitle,
  },
  ttsLabelSelected: {
    color: colors.white,
  },
  actions: {
    gap: 8,
    left: 16,
    position: 'absolute',
  },
  voiceFeedback: {
    backgroundColor: colors.backgroundBottom,
    borderColor: colors.glassBorder,
    borderRadius: 12,
    borderWidth: 1,
    left: layout.horizontalPadding,
    position: 'absolute',
  },
  voiceStatusBox: {
    left: layout.horizontalPadding,
    position: 'absolute',
  },
  voiceFeedbackContent: {
    gap: 8,
    padding: 12,
  },
  voiceMessage: {
    ...typography.info,
    color: colors.subtitle,
  },
  voiceStatus: {
    ...typography.button,
    color: colors.buttonHighlight,
  },
  transcript: {
    ...typography.subtitle,
    color: colors.white,
    marginTop: 4,
  },
});
