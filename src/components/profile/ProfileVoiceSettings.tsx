import { router, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ConversationButton } from '@/components/ai-conversation/ConversationButton';
import { backchannelMaxSec, type ConversationSettings, settingLimits } from '@/core/settings/conversationSettings';
import { hasDeviceTts, newDeviceRequestId, playDeviceVoice, stopDeviceVoice } from '@/core/voice/deviceTts';
import { installHint, voiceCatalog, type DeviceVoice } from '@/core/voice/voiceCatalog';
import { colors, typography } from '@/theme/tokens';

const sample = 'Привет! Я помогу тебе найти *интересных* людей. Расскажешь немного о себе?';
const voices = voiceCatalog.filter((voice): voice is DeviceVoice => voice.kind === 'device' && voice.pack === 'ru');
const voiceName = (voice: DeviceVoice) => voice.label.replace('Silero v5_5_ru · ', '');

interface ProfileVoiceSettingsProps {
  available: boolean | null;
  onChange: (id: string) => Promise<void>;
  settings: ConversationSettings;
  onSettingsChange: (changes: Partial<ConversationSettings>) => Promise<void>;
  selectedId: string;
  top: number;
  bottom: number;
}

const format = (sec: number) => `${sec.toFixed(1).replace('.', ',')} с`;

function Stepper({ label, hint, value, limits, onChange, offAtMin = false }: {
  label: string;
  hint: string;
  value: number;
  limits: { min: number; max: number; step: number };
  onChange: (value: number) => void;
  /** Минимум означает «выключено» (показывается «Выкл»). */
  offAtMin?: boolean;
}) {
  const change = (delta: number) => onChange(Math.round((value + delta) * 10) / 10);
  const shown = offAtMin && value <= limits.min ? 'Выкл' : format(value);
  return (
    <View style={styles.setting}>
      <View style={styles.settingCopy}>
        <Text style={styles.settingLabel}>{label}</Text>
        <Text style={styles.note}>{hint}</Text>
      </View>
      <View accessibilityLabel={`${label}: ${shown}`} style={styles.stepper}>
        <Pressable
          accessibilityLabel={`Уменьшить: ${label}`}
          accessibilityRole="button"
          disabled={value <= limits.min}
          hitSlop={6}
          onPress={() => change(-limits.step)}
          style={[styles.stepButton, value <= limits.min && styles.disabled]}
        >
          <Text style={styles.stepText}>−</Text>
        </Pressable>
        <Text style={styles.stepValue}>{shown}</Text>
        <Pressable
          accessibilityLabel={`Увеличить: ${label}`}
          accessibilityRole="button"
          disabled={value >= limits.max}
          hitSlop={6}
          onPress={() => change(limits.step)}
          style={[styles.stepButton, value >= limits.max && styles.disabled]}
        >
          <Text style={styles.stepText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function ProfileVoiceSettings({
  available, onChange, selectedId, settings, onSettingsChange, top, bottom,
}: ProfileVoiceSettingsProps) {
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const selected = voices.find(({ id }) => id === selectedId) ?? voices[0];

  useEffect(() => () => { void stopDeviceVoice(); }, []);

  const select = async (id: string) => {
    if (playing) return;
    setError('');
    try {
      await onChange(id);
    } catch {
      setError('Не удалось сохранить голос.');
    }
  };

  const listen = async () => {
    if (playing) {
      await stopDeviceVoice();
      return;
    }
    setError('');
    setPlaying(true);
    try {
      await playDeviceVoice(selected.engine, selected.query, sample, newDeviceRequestId(), () => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось воспроизвести голос.');
    } finally {
      setPlaying(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingTop: top, paddingBottom: bottom }]}
      style={StyleSheet.absoluteFill}
    >
      <Text style={styles.title}>Профиль</Text>
      <Text style={styles.heading}>Голос собеседника</Text>
      <View accessibilityLabel="Голос собеседника" accessibilityRole="radiogroup" style={styles.voices}>
        {voices.map((voice) => {
          const checked = voice.id === selected.id;
          return (
            <Pressable
              key={voice.id}
              accessibilityRole="radio"
              accessibilityState={{ checked, disabled: playing }}
              disabled={playing}
              onPress={() => void select(voice.id)}
              style={[styles.voice, checked && styles.voiceSelected]}
            >
              <Text style={[styles.voiceText, checked && styles.voiceTextSelected]}>{voiceName(voice)}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.note}>
        {available === false
          ? `${installHint(selected)} Пока ответы звучат системным голосом.`
          : 'Silero v5_5_ru через RuVoice, без интернета.'}
      </Text>
      {hasDeviceTts && (
        <ConversationButton
          disabled={available === false}
          label={playing ? 'Остановить' : 'Прослушать'}
          onPress={() => void listen()}
        />
      )}
      {error ? <Text accessibilityLiveRegion="polite" style={styles.note}>{error}</Text> : null}

      <Text style={styles.heading}>Темп разговора</Text>
      <View style={styles.card}>
        <Stepper
          hint="Сколько тишины считать концом вашей фразы. Меньше — быстрее ответ, но агент может перебить, если вы задумались."
          label="Пауза конца фразы"
          limits={settingLimits.endOfPhraseSec}
          onChange={(value) => void onSettingsChange({ endOfPhraseSec: value }).catch(() => setError('Не удалось сохранить настройку.'))}
          value={settings.endOfPhraseSec}
        />
        <View style={styles.divider} />
        <Stepper
          hint="Сколько агент молчит перед ответом. Небольшая пауза звучит естественнее мгновенного ответа."
          label="Пауза перед ответом"
          limits={settingLimits.replyDelaySec}
          onChange={(value) => void onSettingsChange({ replyDelaySec: value }).catch(() => setError('Не удалось сохранить настройку.'))}
          value={settings.replyDelaySec}
        />
      </View>
      <Text style={styles.note}>Изменения действуют со следующей реплики.</Text>

      <Text style={styles.heading}>Живой диалог</Text>
      <View style={styles.card}>
        <Stepper
          hint="Если вы замолчали посреди фразы, агент вставит короткое «Понятно» или «Ага» и продолжит слушать. Должна быть меньше паузы конца фразы."
          label="Пауза до короткой реплики"
          limits={{ ...settingLimits.backchannelPauseSec, max: backchannelMaxSec(settings.endOfPhraseSec) }}
          offAtMin
          onChange={(value) => void onSettingsChange({
            // Шаг вниз из 0,5 с выключает реакции, шаг вверх из «Выкл» сразу включает 0,5 с.
            backchannelPauseSec: value <= 0 ? 0 : value < 0.5 ? (settings.backchannelPauseSec > 0 ? 0 : 0.5) : value,
          }).catch(() => setError('Не удалось сохранить настройку.'))}
          value={settings.backchannelPauseSec}
        />
        <View style={styles.divider} />
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: settings.bargeIn }}
          onPress={() => void onSettingsChange({ bargeIn: !settings.bargeIn }).catch(() => setError('Не удалось сохранить настройку.'))}
          style={styles.setting}
        >
          <View style={styles.settingCopy}>
            <Text style={styles.settingLabel}>Перебивать агента голосом</Text>
            <Text style={styles.note}>Пока агент отвечает, микрофон слушает с эхоподавлением. Заговорите — агент замолчит и дослушает вас.</Text>
          </View>
          <View style={[styles.toggle, settings.bargeIn && styles.toggleOn]}>
            <View style={[styles.knob, settings.bargeIn && styles.knobOn]} />
          </View>
        </Pressable>
      </View>
      <Pressable accessibilityRole="button" onPress={() => router.push('/voice-lab' as Href)} style={styles.link}>
        <Text style={styles.linkText}>Voice Lab — сравнение голосов →</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { gap: 12, paddingHorizontal: 16 },
  title: { ...typography.title, color: colors.white },
  heading: { ...typography.subtitle, color: colors.white, marginTop: 12 },
  voices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  voice: { borderColor: colors.glassBorder, borderRadius: 100, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 10 },
  voiceSelected: { backgroundColor: colors.infoBackground, borderColor: colors.buttonHighlight },
  voiceText: { ...typography.button, color: colors.subtitle },
  voiceTextSelected: { color: colors.white },
  note: { ...typography.info, color: colors.subtitle },
  card: { backgroundColor: colors.infoBackground, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 4 },
  setting: { alignItems: 'center', flexDirection: 'row', gap: 12, paddingVertical: 12 },
  settingCopy: { flex: 1, gap: 4 },
  settingLabel: { ...typography.button, color: colors.white },
  divider: { backgroundColor: colors.glassBorder, height: StyleSheet.hairlineWidth },
  stepper: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  stepButton: { alignItems: 'center', borderColor: colors.glassBorder, borderRadius: 16, borderWidth: 1, height: 32, justifyContent: 'center', width: 32 },
  stepText: { color: colors.white, fontSize: 18, lineHeight: 20 },
  stepValue: { ...typography.button, color: colors.white, minWidth: 48, textAlign: 'center' },
  disabled: { opacity: 0.35 },
  toggle: { backgroundColor: colors.glassBorder, borderRadius: 14, height: 28, justifyContent: 'center', paddingHorizontal: 3, width: 48 },
  toggleOn: { backgroundColor: colors.primary },
  knob: { backgroundColor: colors.white, borderRadius: 11, height: 22, width: 22 },
  knobOn: { alignSelf: 'flex-end' },
  link: { alignSelf: 'flex-start', marginTop: 16, paddingVertical: 6 },
  linkText: { ...typography.info, color: colors.buttonHighlight },
});
