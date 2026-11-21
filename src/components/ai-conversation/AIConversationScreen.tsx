import { BlurTargetView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useKeepAwake } from 'expo-keep-awake';
import { useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomTabBar } from '@/components/ai-conversation/BottomTabBar';
import { ConversationButton } from '@/components/ai-conversation/ConversationButton';
import { ConversationCaptions } from '@/components/ai-conversation/ConversationCaptions';
import { ConversationStatusChip } from '@/components/ai-conversation/ConversationStatusChip';
import { Countdown } from '@/components/ai-conversation/Countdown';
import { InfoBanner } from '@/components/ai-conversation/InfoBanner';
import { VoiceWave } from '@/components/ai-conversation/VoiceWave';
import { MatchCard } from '@/components/matches/MatchCard';
import { BlobBackground } from '@/components/ui/BlobBackground';
import { ProfileDialogs } from '@/components/profile/ProfileDialogs';
import { ProfileTab } from '@/components/profile/ProfileTab';
import { ProfileVoiceSettings } from '@/components/profile/ProfileVoiceSettings';
import { BlurBackdrop, BlurTargetContext } from '@/components/ui/BlurBackdrop';
import { SHOW_CONVERSATION_DEBUG } from '@/config/dev';
import { useUserProfile } from '@/core/settings/userProfile';
import { useAndroidVoiceInput } from '@/features/conversation/useAndroidVoiceInput';
import { useAppStore } from '@/store/app-store';
import { fontFamilies } from '@/theme/fonts';
import { colors, layout, typography } from '@/theme/tokens';

const noSoundIcon = require('../../../assets/figma/no-sound.svg');
const noMicrophoneIcon = require('../../../assets/figma/no-microphone.svg');

type Banner = { text: string; progress?: number; onDismiss?: () => void };

/** Приветствие агента после отсчёта при запуске (как образец голоса в настройках). */
const GREETING = 'Привет! Я помогу тебе найти *интересных* людей. Расскажешь немного о себе?';
/** Отсчёт и приветствие — один раз за запуск приложения, при возвращении на экран агент сразу слушает. */
let introPlayed = false;

export function AIConversationScreen() {
  useKeepAwake();
  const voice = useAndroidVoiceInput();
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const activeTab = useAppStore((state) => state.activeTab);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const isInfoVisible = useAppStore((state) => state.isInfoVisible);
  const dismissInfo = useAppStore((state) => state.dismissInfo);
  const [focused, setFocused] = useState(true);
  const [textMode, setTextMode] = useState(false);
  const [draft, setDraft] = useState('');
  const [countdown, setCountdown] = useState<number | null>(null);
  // Всё содержимое экрана — цель размытия для отсчёта и диалогов, которые рисуются поверх.
  const blurTarget = useRef<View>(null);
  const [profileView, setProfileView] = useState<'menu' | 'voice'>('menu');
  const userName = useUserProfile((state) => state.name);
  const loadProfile = useUserProfile((state) => state.load);
  useEffect(() => { void loadProfile(); }, [loadProfile]);

  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));

  // В макете нет кнопки «Начать»: на главном экране приложение слушает само.
  const onMain = activeTab === 'notifications';
  // Под меню профиля — размытый главный экран (макет), поэтому он рисуется и на вкладке «Профиль».
  const profileMenu = activeTab === 'profile' && profileView === 'menu';
  const showMain = onMain || profileMenu;
  const shouldListen = voice.supported && focused && onMain && !textMode && voice.model.phase === 'ready';
  // При запуске: отсчёт 3-2-1 (макет) → приветствие голосом → агент слушает сам до ухода с экрана.
  useEffect(() => {
    if (!shouldListen) {
      setCountdown(null);
      if (voice.isActive) voice.end();
      return;
    }
    if (voice.isActive || voice.phase !== 'idle' || voice.textBusy) return;
    if (introPlayed) void voice.start();
    else setCountdown((value) => value ?? 3);
  }, [shouldListen, voice.isActive, voice.phase, voice.textBusy]); // eslint-disable-line react-hooks/exhaustive-deps

  const beginListening = useCallback(() => {
    introPlayed = true;
    setCountdown(null);
    // Когда приветствие закончится, эффект выше включит прослушивание.
    void voice.greet(GREETING);
  }, [voice]);

  useEffect(() => {
    if (countdown === null) return;
    const timer = setTimeout(() => (countdown > 1 ? setCountdown(countdown - 1) : beginListening()), 900);
    return () => clearTimeout(timer);
  }, [countdown]); // eslint-disable-line react-hooks/exhaustive-deps

  const scale = Math.min(1, width / layout.frameWidth, height / layout.frameHeight);
  const contentWidth = Math.max(0, width - layout.horizontalPadding * 2);
  const titleTop = Math.max(layout.titleTop * scale, insets.top + 18 * scale);
  const tabBarHeight = 84;
  const tabBarTop = height - insets.bottom - 24 * scale - tabBarHeight;
  const spaceAboveTabs = tabBarTop - 16 * scale;
  const actionsTop = Math.min(layout.actionsTop * scale, spaceAboveTabs - 96);
  const infoTop = actionsTop - 70;
  const waveTop = layout.waveTop * scale;
  const waveHeight = layout.waveHeight * scale;
  const waveWidth = layout.waveWidth * scale;
  const waveLeft = (width - layout.frameWidth * scale) / 2 + layout.waveLeft * scale;
  const cardTop = Math.max(66 * scale, insets.top + 14);
  const cardBottom = height - tabBarTop - 2;

  let banner: Banner | null = null;
  if (!voice.supported) {
    banner = { text: 'Голосовое общение доступно в приложении для Android.' };
  } else if (voice.model.phase !== 'ready') {
    banner = voice.model.phase === 'loading'
      ? { text: voice.model.message, progress: voice.model.progress }
      : { text: voice.model.message, onDismiss: voice.retryModel };
  } else if (voice.phase === 'error' && voice.message) {
    banner = { text: voice.message, onDismiss: voice.clearError };
  } else if (voice.voiceNotice) {
    banner = { text: voice.voiceNotice, onDismiss: voice.clearVoiceNotice };
  } else if (voice.muted && voice.reply && !SHOW_CONVERSATION_DEBUG) {
    banner = { text: voice.reply };
  } else if (!textMode && isInfoVisible) {
    banner = { text: 'Задайте вопрос голосом, или опишите текстом.', onDismiss: dismissInfo };
  }

  const tabBar = (
    <BottomTabBar
      activeTab={activeTab}
      bottomInset={insets.bottom + 24 * scale}
      onTabChange={(tab) => {
        setProfileView('menu');
        setActiveTab(tab);
      }}
      scale={scale}
      width={contentWidth}
    />
  );

  const send = () => {
    const text = draft;
    setDraft('');
    void voice.sendText(text);
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <BlurTargetContext.Provider value={blurTarget}>
        <BlurTargetView ref={blurTarget} style={StyleSheet.absoluteFill}>
          <LinearGradient
            colors={[colors.backgroundTop, colors.backgroundBottom]}
            end={{ x: 0.5, y: 1 }}
            start={{ x: 0.5, y: 0 }}
            style={StyleSheet.absoluteFill}
          />

          {showMain ? (
            <>
              <View style={[styles.textBlock, { top: titleTop, width: contentWidth }]}>
                <Text style={styles.title}>Добрый день, {userName}</Text>
                {SHOW_CONVERSATION_DEBUG && voice.transcript ? (
                  <View style={{ maxHeight: Math.max(0, waveTop - titleTop - 33 * scale - 14), overflow: 'hidden' }}>
                    <ConversationCaptions reply={voice.reply} transcript={voice.transcript} />
                  </View>
                ) : (
                  <Text style={styles.subtitle}>
                    Я помогу вам найти: любовь, друзей, или просто хорошую компанию для похода на выставку или в кино.
                  </Text>
                )}
              </View>

              <VoiceWave active={focused} height={waveHeight} left={waveLeft} level={voice.audioLevel} status={voice.status} top={waveTop} width={waveWidth} />

              {SHOW_CONVERSATION_DEBUG && voice.supported && voice.model.phase === 'ready' && (
                <ConversationStatusChip
                  micOff={textMode}
                  soundOff={voice.muted}
                  status={voice.status}
                  timings={voice.timings}
                  top={waveTop}
                />
              )}

              {banner && (
                <InfoBanner
                  onDismiss={banner.onDismiss}
                  progress={banner.progress}
                  scale={scale}
                  text={banner.text}
                  top={textMode ? infoTop - 64 * scale : infoTop}
                  width={contentWidth}
                />
              )}

              {textMode && (
                <View style={[styles.composer, { top: infoTop, width: contentWidth, minHeight: 54 * scale }]}>
                  <TextInput
                    accessibilityLabel="Сообщение"
                    autoFocus
                    editable={!voice.textBusy}
                    onChangeText={setDraft}
                    onSubmitEditing={send}
                    placeholder="Опишите текстом"
                    placeholderTextColor={colors.subtitle}
                    returnKeyType="send"
                    style={styles.input}
                    value={draft}
                  />
                  <Pressable
                    accessibilityLabel="Отправить"
                    accessibilityRole="button"
                    disabled={!draft.trim() || voice.textBusy}
                    hitSlop={8}
                    onPress={send}
                    style={[styles.send, (!draft.trim() || voice.textBusy) && styles.disabled]}
                  >
                    <Text style={styles.sendText}>↑</Text>
                  </Pressable>
                </View>
              )}

              {voice.supported && (
                <View style={[styles.actions, { top: actionsTop, width: contentWidth }]}>
                  <ConversationButton
                    accessibilityHint="Ответы будут показаны текстом без озвучки"
                    iconSource={noSoundIcon}
                    label="Не могу слушать"
                    onPress={voice.toggleMuted}
                    variant={voice.muted ? 'secondary' : 'primary'}
                  />
                  <ConversationButton
                    accessibilityHint="Микрофон выключится, можно писать текстом"
                    iconSource={noMicrophoneIcon}
                    label="Не могу говорить"
                    onPress={() => setTextMode((value) => !value)}
                    variant={textMode ? 'secondary' : 'primary'}
                  />
                </View>
              )}
            </>
          ) : activeTab === 'profile' ? (
            <ProfileVoiceSettings
              onBack={() => setProfileView('menu')}
              available={voice.sileroAvailable}
              bottom={height - tabBarTop + 16}
              onChange={voice.changeVoice}
              onSettingsChange={voice.updateSettings}
              selectedId={voice.sileroVoiceId}
              settings={voice.settings}
              top={titleTop}
            />
          ) : (
            <>
              <BlobBackground
                active={focused}
                card={{ x: layout.horizontalPadding, y: cardTop, width: contentWidth, height: height - cardTop - cardBottom, radius: 36 }}
                height={height}
                width={width}
              />
              <MatchCard bottom={cardBottom} top={cardTop} width={contentWidth} />
            </>
          )}

          {!profileMenu && tabBar}
        </BlurTargetView>

        {profileMenu && (
          <>
            <BlurBackdrop dim="rgba(6, 4, 24, 0.25)" intensity={85} />
            <ProfileTab bottom={height - tabBarTop - 4} onVoiceSettings={() => setProfileView('voice')} />
            {/* Панель вкладок над размытием остаётся чёткой, как в макете. */}
            {tabBar}
          </>
        )}

        {onMain && countdown !== null && <Countdown onSkip={beginListening} top={waveTop + 20 * scale} value={countdown} />}
        <ProfileDialogs />
      </BlurTargetContext.Provider>
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
    gap: 4,
    left: layout.horizontalPadding,
    position: 'absolute',
  },
  title: {
    ...typography.title,
    color: colors.white,
  },
  subtitle: {
    ...typography.subtitle,
    color: colors.subtitle,
  },
  actions: {
    gap: 8,
    left: layout.horizontalPadding,
    position: 'absolute',
  },
  composer: {
    alignItems: 'center',
    backgroundColor: colors.infoBackground,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 10,
    left: layout.horizontalPadding,
    paddingHorizontal: 16,
    paddingVertical: 6,
    position: 'absolute',
  },
  input: {
    ...typography.info,
    color: colors.white,
    flex: 1,
    paddingVertical: 8,
  },
  send: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  sendText: {
    color: colors.white,
    fontFamily: fontFamilies.control,
    fontSize: 18,
  },
  disabled: {
    opacity: 0.45,
  },
});
