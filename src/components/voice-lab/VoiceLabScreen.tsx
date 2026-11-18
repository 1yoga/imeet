import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { useKeepAwake } from 'expo-keep-awake';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { hasAndroidTts, loadAndroidTts } from '@/core/voice/androidTts';
import type { TtsEngine, TtsPlaybackHandle } from '@/core/voice/contracts';
import {
  disposeSupertonicLab,
  hasSupertonicTts,
  initializeSupertonicForLab,
  playSupertonicVoice,
  stopSupertonicVoice,
  supertonicVoices,
  type SupertonicVoiceName,
} from '@/core/voice/supertonicTts';
import { colors, typography } from '@/theme/tokens';

type VoiceName = SupertonicVoiceName | 'system';
type Score = 1 | 2 | 3 | 4 | 5;
type Criterion = 'naturalness' | 'pleasantness';
type Ratings = Partial<Record<VoiceName, Partial<Record<Criterion, Score>>>>;
type RunMetrics = {
  voice: VoiceName;
  phrase: string;
  synthesisMs?: number;
  firstFrameMs?: number;
  state: 'preparing' | 'playing' | 'completed' | 'stopped' | 'error';
};

const storageKey = '@imeet/voice-lab/ratings-v1';
const samples = [
  { label: 'Приветствие', text: 'Привет! Как хорошо, что мы снова на связи.' },
  { label: 'Вопрос', text: 'Чем ты любишь заниматься в свободное время?' },
  { label: 'Эмоциональный ответ', text: 'Вот это здорово! Расскажи скорее, как всё получилось.' },
  { label: 'Сомнение', text: 'Хм, не знаю… Может, попробуем по-другому?' },
  { label: 'Угу', text: 'Угу.' },
  { label: 'Мгм', text: 'Мгм.' },
  { label: 'Ага', text: 'Ага.' },
  { label: 'Поддержка', text: 'Понимаю тебя. Такое бывает, давай не спешить.' },
  { label: 'Предложение', text: 'Может, выберем фильм и устроим уютный вечер?' },
] as const;
const voices: VoiceName[] = [...supertonicVoices.map(({ name }) => name), 'system'];

function readRatings(raw: string | null): Ratings {
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const result: Ratings = {};
  for (const voice of voices) {
    const entry = (parsed as Record<string, unknown>)[voice];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const values = entry as Record<string, unknown>;
    const rating: Partial<Record<Criterion, Score>> = {};
    if ([1, 2, 3, 4, 5].includes(values.naturalness as number)) rating.naturalness = values.naturalness as Score;
    if ([1, 2, 3, 4, 5].includes(values.pleasantness as number)) rating.pleasantness = values.pleasantness as Score;
    result[voice] = rating;
  }
  return result;
}

export function VoiceLabScreen() {
  useKeepAwake();
  const insets = useSafeAreaInsets();
  const [voice, setVoice] = useState<VoiceName>('F1');
  const [customText, setCustomText] = useState('');
  const [modelMessage, setModelMessage] = useState(hasSupertonicTts
    ? 'Подготавливаем Supertonic…'
    : 'Supertonic доступен в Android APK с нативным модулем.');
  const [supertonicReady, setSupertonicReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [metrics, setMetrics] = useState<RunMetrics | null>(null);
  const [history, setHistory] = useState<RunMetrics[]>([]);
  const [ratings, setRatings] = useState<Ratings>({});
  const [ratingsLoaded, setRatingsLoaded] = useState(false);
  const [storageError, setStorageError] = useState('');
  const busyRef = useRef(false);
  const requestIdRef = useRef(0);
  const systemTtsRef = useRef<TtsEngine | null>(null);
  const playbackRef = useRef<TtsPlaybackHandle | null>(null);
  const playingVoiceRef = useRef<VoiceName | null>(null);
  const saveQueueRef = useRef(Promise.resolve());

  useEffect(() => {
    let mounted = true;
    void AsyncStorage.getItem(storageKey).then((raw) => {
      if (mounted) setRatings(readRatings(raw));
      if (mounted) setRatingsLoaded(true);
    }).catch(() => {
      if (mounted) setStorageError('Не удалось прочитать сохранённые оценки.');
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!ratingsLoaded) return;
    const value = JSON.stringify(ratings);
    saveQueueRef.current = saveQueueRef.current.catch(() => {}).then(() => AsyncStorage.setItem(storageKey, value));
    void saveQueueRef.current.then(() => setStorageError('')).catch(() => {
      setStorageError('Не удалось сохранить оценки на устройстве.');
    });
  }, [ratings, ratingsLoaded]);

  useEffect(() => {
    let mounted = true;
    let ready = false;
    if (hasSupertonicTts) {
      void initializeSupertonicForLab(({ receivedBytes, totalBytes }) => {
        if (mounted && totalBytes > 0) {
          setModelMessage(`Загружаем Supertonic… ${Math.floor(receivedBytes / 1048576)} / ${Math.ceil(totalBytes / 1048576)} МиБ`);
        }
      }).then(() => {
        ready = true;
        if (mounted) {
          setSupertonicReady(true);
          setModelMessage('Supertonic готов. Все десять голосов используют одну модель.');
        } else {
          void disposeSupertonicLab();
        }
      }).catch(() => {
        if (mounted) setModelMessage('Не удалось подготовить Supertonic. Проверьте модель и интернет.');
      });
    }
    return () => {
      mounted = false;
      if (ready) {
        void stopSupertonicVoice().finally(disposeSupertonicLab);
      }
      void systemTtsRef.current?.stop();
    };
  }, []);

  const rate = (criterion: Criterion, score: Score) => {
    if (!ratingsLoaded) return;
    setRatings((current) => ({
      ...current,
      [voice]: { ...current[voice], [criterion]: score },
    }));
  };

  const stop = async () => {
    if (!busyRef.current) return;
    if (playingVoiceRef.current === 'system') {
      await playbackRef.current?.stop();
    } else {
      await stopSupertonicVoice();
    }
  };

  const play = async (text: string, phrase: string) => {
    const spokenText = text.trim();
    if (!spokenText || spokenText.length > 500 || busyRef.current) return;
    if (voice !== 'system' && !supertonicReady) return;
    if (voice === 'system' && !hasAndroidTts) return;

    busyRef.current = true;
    playingVoiceRef.current = voice;
    setBusy(true);
    let run: RunMetrics = { voice, phrase, state: 'preparing' };
    const updateRun = (changes: Partial<RunMetrics>) => {
      run = { ...run, ...changes };
      setMetrics(run);
    };
    setMetrics(run);
    try {
      if (voice === 'system') {
        const startedAt = performance.now();
        if (!systemTtsRef.current) {
          const engine = await loadAndroidTts();
          if (!engine) throw new Error('Системный TTS недоступен');
          await engine.initialize();
          systemTtsRef.current = engine;
        }
        const handle = await systemTtsRef.current.speak({
          text: spokenText,
          locale: 'ru-RU',
          onStart: () => updateRun({
            firstFrameMs: Math.round(performance.now() - startedAt),
            state: 'playing',
          }),
        });
        playbackRef.current = handle;
        const result = await handle.finished;
        updateRun({ state: result });
      } else {
        const requestId = ++requestIdRef.current;
        const result = await playSupertonicVoice(spokenText, voice, requestId, ({ synthesisMs, firstFrameMs }) => {
          updateRun({
            synthesisMs,
            firstFrameMs,
            state: 'playing',
          });
        });
        updateRun({ state: result });
      }
    } catch {
      updateRun({ state: 'error' });
    } finally {
      setHistory((current) => [run, ...current].slice(0, 20));
      playbackRef.current = null;
      playingVoiceRef.current = null;
      busyRef.current = false;
      setBusy(false);
    }
  };

  const canPlay = voice === 'system' ? hasAndroidTts : supertonicReady;
  const voiceLabel = (name: VoiceName) => name === 'system' ? 'Системный Android TTS' : name;

  return (
    <View style={styles.screen}>
      <LinearGradient colors={[colors.backgroundTop, colors.backgroundBottom]} style={StyleSheet.absoluteFill} />
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>‹ Назад к разговору</Text>
        </Pressable>
        <Text style={styles.title}>Voice Lab</Text>
        <Text style={styles.description}>Сравните русское звучание на одинаковых репликах и оцените каждый голос.</Text>

        <Text style={styles.heading}>Голос</Text>
        <View accessibilityLabel="Голоса" accessibilityRole="radiogroup" style={styles.voiceGrid}>
          {voices.map((name) => {
            const disabled = busy;
            return (
              <Pressable
                key={name}
                accessibilityRole="radio"
                accessibilityState={{ checked: voice === name, disabled }}
                disabled={disabled}
                onPress={() => setVoice(name)}
                style={[styles.voiceChip, voice === name && styles.selectedChip, disabled && styles.disabled]}
              >
                <Text style={styles.chipText}>{voiceLabel(name)}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.note}>{modelMessage}</Text>

        <Text style={styles.heading}>Тестовые реплики</Text>
        {samples.map(({ label, text }) => (
          <View key={label} style={styles.sampleRow}>
            <View style={styles.sampleCopy}>
              <Text style={styles.sampleLabel}>{label}</Text>
              <Text style={styles.sampleText}>{text}</Text>
            </View>
            <Pressable accessibilityLabel={`Слушать: ${label}`} accessibilityRole="button" disabled={!canPlay || busy} onPress={() => void play(text, label)} style={[styles.playSmall, (!canPlay || busy) && styles.disabled]}>
              <Text style={styles.playSmallText}>▶</Text>
            </Pressable>
          </View>
        ))}

        <Text style={styles.heading}>Свой текст</Text>
        <TextInput
          accessibilityLabel="Текст для проверки голоса"
          maxLength={500}
          multiline
          onChangeText={setCustomText}
          placeholder="Введите фразу по-русски"
          placeholderTextColor={colors.subtitle}
          style={styles.input}
          value={customText}
        />
        <Pressable accessibilityRole="button" disabled={!canPlay || busy || !customText.trim()} onPress={() => void play(customText, 'Свой текст')} style={[styles.primaryButton, (!canPlay || busy || !customText.trim()) && styles.disabled]}>
          <Text style={styles.primaryText}>Воспроизвести свой текст</Text>
        </Pressable>
        {busy && (
          <Pressable accessibilityRole="button" onPress={() => void stop()} style={styles.stopButton}>
            <Text style={styles.primaryText}>Остановить</Text>
          </Pressable>
        )}

        {metrics && (
          <View style={styles.card}>
            <Text style={styles.heading}>Последний запуск · {voiceLabel(metrics.voice)}</Text>
            <Text style={styles.sampleText}>{metrics.phrase}</Text>
            <Text style={styles.metric}>Синтез: {metrics.synthesisMs === undefined ? '—' : `${metrics.synthesisMs} мс`}</Text>
            <Text style={styles.metric}>Задержка до начала звука: {metrics.firstFrameMs === undefined ? '—' : `${metrics.firstFrameMs} мс`}</Text>
            <Text style={styles.note}>{metrics.state === 'error' ? 'Воспроизведение не удалось.' : metrics.state === 'preparing' ? 'Подготавливаем звук…' : metrics.state === 'playing' ? 'Идёт озвучка…' : metrics.state === 'stopped' ? 'Остановлено.' : 'Готово.'}</Text>
            {metrics.voice === 'system' && <Text style={styles.note}>Для системного TTS Android время до начала измерено по событию onStart; отдельное время синтеза движок не предоставляет.</Text>}
          </View>
        )}

        {history.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.heading}>Последние запуски</Text>
            {history.map((run, index) => (
              <Text key={`${index}-${run.voice}-${run.phrase}`} style={styles.note}>
                {voiceLabel(run.voice)} · {run.phrase}: синтез {run.synthesisMs === undefined ? '—' : `${run.synthesisMs} мс`}, до звука {run.firstFrameMs === undefined ? '—' : `${run.firstFrameMs} мс`}
              </Text>
            ))}
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.heading}>Оценка · {voiceLabel(voice)}</Text>
          {(['naturalness', 'pleasantness'] as const).map((criterion) => (
            <View key={criterion} style={styles.ratingRow}>
              <Text style={styles.ratingLabel}>{criterion === 'naturalness' ? 'Естественность' : 'Приятность'}</Text>
              <View style={styles.scoreRow}>
                {([1, 2, 3, 4, 5] as const).map((score) => (
                  <Pressable
                    key={score}
                    accessibilityLabel={`${criterion === 'naturalness' ? 'Естественность' : 'Приятность'}: ${score} из 5`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: ratings[voice]?.[criterion] === score, disabled: !ratingsLoaded }}
                    disabled={!ratingsLoaded}
                    onPress={() => rate(criterion, score)}
                    style={[styles.score, ratings[voice]?.[criterion] === score && styles.selectedScore]}
                  >
                    <Text style={styles.scoreText}>{score}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
          <Text style={styles.note}>{storageError || (ratingsLoaded ? 'Оценки сохраняются на этом устройстве.' : 'Загружаем оценки…')}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.backgroundTop },
  content: { paddingHorizontal: 20, gap: 12 },
  back: { alignSelf: 'flex-start', paddingVertical: 8 },
  backText: { color: colors.buttonHighlight, fontSize: 16 },
  title: { color: colors.white, fontFamily: typography.title.fontFamily, fontSize: 32 },
  description: { color: colors.subtitle, fontSize: 15, lineHeight: 22, marginBottom: 8 },
  heading: { color: colors.white, fontSize: 18, fontWeight: '600', marginTop: 10 },
  voiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  voiceChip: { borderColor: colors.glassBorder, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10 },
  selectedChip: { backgroundColor: colors.infoBackground, borderColor: colors.buttonHighlight },
  chipText: { color: colors.white, fontSize: 15 },
  disabled: { opacity: 0.45 },
  note: { color: colors.subtitle, fontSize: 13, lineHeight: 19 },
  sampleRow: { alignItems: 'center', borderColor: colors.glassBorder, borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 12, padding: 12 },
  sampleCopy: { flex: 1, gap: 4 },
  sampleLabel: { color: colors.buttonHighlight, fontSize: 13, fontWeight: '600' },
  sampleText: { color: colors.white, fontSize: 15, lineHeight: 21 },
  playSmall: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 24, height: 42, justifyContent: 'center', width: 42 },
  playSmallText: { color: colors.white, fontSize: 18 },
  input: { borderColor: colors.glassBorder, borderRadius: 14, borderWidth: 1, color: colors.white, fontSize: 16, minHeight: 100, padding: 14, textAlignVertical: 'top' },
  primaryButton: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 14, padding: 16 },
  stopButton: { alignItems: 'center', borderColor: colors.glassBorder, borderRadius: 14, borderWidth: 1, padding: 15 },
  primaryText: { color: colors.white, fontSize: 16, fontWeight: '600' },
  card: { backgroundColor: colors.infoBackground, borderRadius: 16, gap: 8, padding: 16 },
  metric: { color: colors.white, fontSize: 15 },
  ratingRow: { gap: 8, marginTop: 6 },
  ratingLabel: { color: colors.subtitle, fontSize: 15 },
  scoreRow: { flexDirection: 'row', gap: 8 },
  score: { alignItems: 'center', borderColor: colors.glassBorder, borderRadius: 10, borderWidth: 1, flex: 1, paddingVertical: 10 },
  selectedScore: { backgroundColor: colors.primary, borderColor: colors.buttonHighlight },
  scoreText: { color: colors.white, fontSize: 15 },
});
