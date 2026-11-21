import { Image } from 'expo-image';
import { useKeepAwake } from 'expo-keep-awake';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConversationButton } from '@/components/ai-conversation/ConversationButton';
import { GlassSurface } from '@/components/ai-conversation/GlassSurface';
import { VoiceWave } from '@/components/ai-conversation/VoiceWave';
import { useUserProfile } from '@/core/settings/userProfile';
import { useAndroidVoiceInput } from '@/features/conversation/useAndroidVoiceInput';
import { createCandidateQa } from '@/features/matches/candidateQa';
import { ageLabel, type Candidate } from '@/features/matches/candidates';
import { colors, layout, typography } from '@/theme/tokens';

import { AskComposer } from './AskComposer';
import { uiIcons } from './icons';
import { PhotoStrip } from './PhotoStrip';
import { TraitChip } from './TraitChip';

const noSoundIcon = require('../../../assets/figma/no-sound.svg');
const noMicrophoneIcon = require('../../../assets/figma/no-microphone.svg');

/** Профиль кандидата (Figma «Профиль» 73:521, 141:2487, 141:2637): анкета и вопросы агенту о человеке. */
export function CandidateProfileScreen({ candidate }: { candidate: Candidate }) {
  useKeepAwake();
  const voice = useAndroidVoiceInput({ createReplies: () => createCandidateQa(candidate) });
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scroll = useRef<ScrollView>(null);
  const [focused, setFocused] = useState(true);
  const [textMode, setTextMode] = useState(false);
  const [draft, setDraft] = useState('');
  const userName = useUserProfile((state) => state.name);

  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => setFocused(false);
  }, []));

  // Как на главном экране: пока экран открыт и не включён текстовый режим, агент слушает сам.
  const shouldListen = voice.supported && focused && !textMode && voice.model.phase === 'ready';
  useEffect(() => {
    if (shouldListen && !voice.isActive && voice.phase === 'idle') void voice.start();
    if (!shouldListen && voice.isActive) voice.end();
  }, [shouldListen, voice.isActive, voice.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const answered = Boolean(voice.transcript && voice.reply);
  useEffect(() => {
    if (answered) setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 120);
  }, [answered, voice.reply]);

  const send = () => {
    const text = draft;
    setDraft('');
    void voice.sendText(text);
  };
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const openPhoto = (index: number) =>
    router.push({ pathname: '/photos/[id]', params: { id: candidate.id, index: String(index) } });

  const scale = Math.min(1, width / layout.frameWidth);
  const waveWidth = layout.waveWidth * scale;
  const waveHeight = layout.waveHeight * scale;
  const waveLeft = (width - layout.frameWidth * scale) / 2 + layout.waveLeft * scale;
  const listening = voice.isActive && !textMode;

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <LinearGradient
        colors={[colors.backgroundTop, colors.backgroundBottom]}
        end={{ x: 0.5, y: 1 }}
        start={{ x: 0.5, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Фиолетовое свечение справа сверху, как в макете. */}
      <LinearGradient
        colors={['rgba(150, 130, 255, 0.42)', 'rgba(65, 50, 241, 0.16)', 'rgba(7, 5, 30, 0)']}
        end={{ x: 0.15, y: 0.55 }}
        pointerEvents="none"
        start={{ x: 1, y: 0 }}
        style={styles.glow}
      />

      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24, paddingTop: insets.top + 8 }]}
          keyboardShouldPersistTaps="handled"
          ref={scroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.top}>
            <Pressable accessibilityLabel="Назад" accessibilityRole="button" hitSlop={12} onPress={back} style={styles.back}>
              <Image contentFit="contain" source={uiIcons.arrowLeft} style={styles.backIcon} />
            </Pressable>
            <Pressable accessibilityLabel="Открыть фото" onPress={() => openPhoto(0)}>
              <Image contentFit="cover" source={candidate.avatar} style={styles.avatar} />
            </Pressable>
            <Text style={styles.city}>Город: {candidate.city}</Text>
            <Text style={styles.name}>{candidate.name}, {ageLabel(candidate.age)}</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.heading}>Характеристика:</Text>
            <View style={styles.chips}>
              {candidate.traits.map((trait) => <TraitChip key={trait.label} trait={trait} />)}
            </View>
          </View>
          <View style={styles.section}>
            <Text style={styles.heading}>Интересы:</Text>
            <View style={styles.chips}>
              {candidate.interests.map((trait) => <TraitChip key={trait.label} trait={trait} />)}
            </View>
          </View>
          <View style={styles.photos}>
            <Text style={[styles.heading, styles.padded]}>Фотографии:</Text>
            <PhotoStrip height={166} inset={16} onOpen={openPhoto} photoWidth={150} photos={candidate.photos} />
          </View>

          {answered ? (
            <View style={styles.answer}>
              <View style={styles.divider} />
              <View style={styles.bubble}>
                <Text style={styles.bubbleText}>{voice.transcript}</Text>
              </View>
              <Text style={styles.reply}>{voice.reply}</Text>

              <View style={styles.offer}>
                <GlassSurface style={styles.offerGlass} />
                <Text style={styles.offerText}>
                  Хотите узнать еще что-то?{'\n'}Или можете отправить сообщение ей лично.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push({ pathname: '/chat/[id]', params: { id: candidate.id } })}
                  style={styles.chatButton}
                >
                  <LinearGradient
                    colors={[colors.buttonHighlight, colors.primary]}
                    end={{ x: 1, y: 0.5 }}
                    start={{ x: 0, y: 0.5 }}
                    style={styles.chatGradient}
                  >
                    <Image contentFit="contain" source={uiIcons.chat} style={styles.chatIcon} />
                    <Text style={styles.chatText}>Начать чат</Text>
                  </LinearGradient>
                </Pressable>
              </View>

              {listening && (
                <View style={styles.listening}>
                  <View style={[styles.dot, voice.status === 'user-speaking' && styles.dotHot]} />
                  <Text style={styles.listeningText}>
                    {voice.status === 'speaking' ? 'Отвечаю…' : 'Слушаю — спросите голосом или напишите'}
                  </Text>
                </View>
              )}
              <View style={styles.padded}>
                <AskComposer
                  busy={voice.textBusy}
                  onChange={setDraft}
                  onSend={send}
                  placeholder="Задать вопрос"
                  value={draft}
                />
              </View>
            </View>
          ) : (
            <View style={styles.ask}>
              <View style={styles.padded}>
                <Text style={styles.title}>Добрый день, {userName}</Text>
                <Text style={styles.subtitle}>
                  {voice.model.phase === 'loading'
                    ? voice.model.message
                    : voice.phase === 'error' && voice.message
                      ? voice.message
                      : `Уточните ваш вопрос для ${candidate.nameGenitive}`}
                </Text>
              </View>

              <View style={styles.waveSlot}>
                <VoiceWave
                  active={focused}
                  height={waveHeight}
                  left={waveLeft}
                  level={voice.audioLevel}
                  status={voice.status}
                  top={-24 * scale}
                  width={waveWidth}
                />
              </View>

              <View style={[styles.padded, styles.actions]}>
                {textMode ? (
                  <>
                    <AskComposer
                      autoFocus
                      busy={voice.textBusy}
                      onChange={setDraft}
                      onSend={send}
                      placeholder={`Например: чем ${candidate.name} увлекается?`}
                      value={draft}
                      variant="box"
                    />
                    <Pressable accessibilityRole="button" onPress={() => setTextMode(false)} style={styles.link}>
                      <Text style={styles.linkText}>Спросить голосом</Text>
                    </Pressable>
                  </>
                ) : voice.supported ? (
                  <>
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
                      onPress={() => setTextMode(true)}
                    />
                  </>
                ) : (
                  <AskComposer onChange={setDraft} onSend={send} placeholder="Задать вопрос" value={draft} />
                )}
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.backgroundTop, flex: 1 },
  flex: { flex: 1 },
  glow: { height: 520, position: 'absolute', right: 0, top: 0, width: '85%' },
  content: { gap: 18 },
  top: { alignItems: 'center' },
  back: { left: 16, position: 'absolute', top: 36, zIndex: 1 },
  backIcon: { height: 24, width: 24 },
  avatar: { borderRadius: 54, height: 108, width: 108 },
  city: { ...typography.subtitle, color: colors.subtitle, fontSize: 15, marginTop: 10 },
  name: { ...typography.title, color: colors.white, fontSize: 27, fontWeight: '600', lineHeight: 33 },
  section: { gap: 8, paddingHorizontal: 16 },
  padded: { paddingHorizontal: 16 },
  heading: { ...typography.title, color: colors.white, fontSize: 18, fontWeight: '600', lineHeight: 22 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photos: { gap: 10 },
  ask: { gap: 8, marginTop: 8 },
  title: { ...typography.title, color: colors.white },
  subtitle: { ...typography.subtitle, color: colors.subtitle, marginTop: 4 },
  waveSlot: { height: 170 },
  actions: { gap: 8 },
  link: { alignSelf: 'center', paddingVertical: 8 },
  linkText: { ...typography.button, color: colors.buttonHighlight },
  answer: { gap: 18 },
  divider: { backgroundColor: 'rgba(255, 255, 255, 0.16)', height: StyleSheet.hairlineWidth * 2 },
  bubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#C6C0F7',
    borderRadius: 24,
    marginHorizontal: 16,
    maxWidth: '76%',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  bubbleText: { ...typography.subtitle, color: '#1A1446', fontSize: 15 },
  reply: { ...typography.title, color: colors.white, fontSize: 20, lineHeight: 27, paddingHorizontal: 16 },
  offer: {
    alignItems: 'center',
    borderColor: colors.glassBorder,
    borderRadius: 20,
    borderWidth: 1,
    gap: 12,
    marginHorizontal: 16,
    overflow: 'hidden',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  offerGlass: { borderRadius: 20 },
  offerText: { ...typography.subtitle, color: colors.white, fontSize: 14.5, lineHeight: 19, textAlign: 'center' },
  chatButton: { borderRadius: 22, overflow: 'hidden' },
  chatGradient: { alignItems: 'center', flexDirection: 'row', gap: 10, height: 42, paddingHorizontal: 26 },
  chatIcon: { height: 22, width: 22 },
  chatText: { ...typography.button, color: colors.white, fontSize: 15 },
  listening: { alignItems: 'center', flexDirection: 'row', gap: 8, marginBottom: -8, paddingHorizontal: 20 },
  dot: { backgroundColor: colors.buttonHighlight, borderRadius: 4, height: 8, opacity: 0.6, width: 8 },
  dotHot: { backgroundColor: '#8BFFB0', opacity: 1 },
  listeningText: { ...typography.info, color: colors.subtitle, fontSize: 13 },
});
