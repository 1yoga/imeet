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
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { hasAndroidTts, loadAndroidTts } from '@/core/voice/androidTts';
import type { TtsEngine, TtsPlaybackHandle } from '@/core/voice/contracts';
import { hasDeviceTts, inspectDeviceVoice, newDeviceRequestId, playDeviceVoice, stopDeviceVoice } from '@/core/voice/deviceTts';
import {
  defaultConversationVoiceId,
  findVoice,
  installHint,
  loadConversationVoiceId,
  saveConversationVoiceId,
  voiceCatalog,
} from '@/core/voice/voiceCatalog';
import { stripFocusMarks } from '@/core/voice/focusMarks';
import {
  embeddedSileroStatus,
  hasEmbeddedSilero,
  loadEmbeddedSilero,
  playEmbeddedSilero,
  stopEmbeddedSilero,
} from '@/core/voice/sileroEmbedded';
import { hasVoiceMetrics, snapshotAppMemory } from '@/core/voice/voiceMetrics';
import { fontFamilies } from '@/theme/fonts';
import { colors, typography } from '@/theme/tokens';

type Score = 1 | 2 | 3 | 4 | 5;
type Criterion = 'stress' | 'question' | 'accent' | 'emotion';
type Ratings = Partial<Record<string, Partial<Record<Criterion, Score>>>>;
type RunMetrics = {
  voice: string;
  phrase: string;
  firstFrameMs?: number;
  synthMs?: number;
  audioMs?: number;
  accented?: string;
  appPssKb?: number;
  error?: string;
  state: 'preparing' | 'playing' | 'completed' | 'stopped' | 'error';
};

const storageKey = '@imeet/voice-lab/ratings-v2';
const criteria = [
  { id: 'stress', label: 'Ударения' },
  { id: 'question', label: 'Вопросительная интонация' },
  { id: 'accent', label: 'Иностранный акцент' },
  { id: 'emotion', label: 'Эмоции' },
] as const;
const samples = [
  { label: 'История и вопрос', text: 'Вчера вечером мы с Женей гуляли в Новосибирске и случайно увидели старинный замок на холме. Когда подошли ближе, заметили тяжёлый замок на деревянной двери. Ты бы решился открыть её и узнать, что спрятано внутри?' },
  { label: 'Встреча и эмоции', text: 'Как же здорово, что ты наконец приехал! Я так обрадовался, что сразу позвонил друзьям и рассказал им удивительную новость. Давай спокойно выпьем чаю, посмеёмся над старой историей и решим, куда отправимся завтра?' },
  { label: 'Короткий вопрос', text: 'А ты любишь гулять по вечерам?' },
  { label: 'Тот же вопрос с выделением', text: 'А ты *любишь* гулять по вечерам?' },
  { label: 'Выбор с выделением', text: 'Тебе интереснее новый *город* или *природа*?' },
  { label: 'Реакции', text: 'Понятно. Вот как! Ага, понимаю. Ничего себе!' },
] as const;
const voiceIds = voiceCatalog.map(({ id }) => id);
const voiceLabel = (id: string) => findVoice(id)?.label ?? id;

function readRatings(raw: string | null): Ratings {
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const result: Ratings = {};
  for (const voice of voiceIds) {
    const entry = (parsed as Record<string, unknown>)[voice];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const values = entry as Record<string, unknown>;
    const rating: Partial<Record<Criterion, Score>> = {};
    for (const { id } of criteria) {
      if ([1, 2, 3, 4, 5].includes(values[id] as number)) rating[id] = values[id] as Score;
    }
    result[voice] = rating;
  }
  return result;
}

export function VoiceLabScreen() {
  useKeepAwake();
  const insets = useSafeAreaInsets();
  const [voice, setVoice] = useState(defaultConversationVoiceId);
  const [conversationVoice, setConversationVoice] = useState(defaultConversationVoiceId);
  const [deviceVoice, setDeviceVoice] = useState<{ available: boolean; reason: string } | null>(null);
  const [embeddedState, setEmbeddedState] = useState<{ ready: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [metrics, setMetrics] = useState<RunMetrics | null>(null);
  const [history, setHistory] = useState<RunMetrics[]>([]);
  const [ratings, setRatings] = useState<Ratings>({});
  const [ratingsLoaded, setRatingsLoaded] = useState(false);
  const [storageError, setStorageError] = useState('');
  const busyRef = useRef(false);
  const systemTtsRef = useRef<TtsEngine | null>(null);
  const playbackRef = useRef<TtsPlaybackHandle | null>(null);
  const playingVoiceRef = useRef<string | null>(null);
  const saveQueueRef = useRef(Promise.resolve());

  useEffect(() => {
    let mounted = true;
    void AsyncStorage.getItem(storageKey).then((raw) => {
      if (mounted) setRatings(readRatings(raw));
      if (mounted) setRatingsLoaded(true);
    }).catch(() => {
      if (mounted) setStorageError('Не удалось прочитать сохранённые оценки.');
    });
    void loadConversationVoiceId().then((id) => {
      if (mounted) setConversationVoice(id);
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (findVoice(voice)?.kind !== 'embedded') return;
    let mounted = true;
    setEmbeddedState(null);
    void (async () => {
      try {
        const status = await embeddedSileroStatus();
        if (!status.bundled) {
          if (mounted) setEmbeddedState({ ready: false, text: hasEmbeddedSilero ? 'Модели не вложены в эту сборку: запустите tools\\silero-onnx\\run.cmd и пересоберите APK.' : 'Нужна новая Android-сборка iMeet.' });
          return;
        }
        if (mounted) setEmbeddedState({ ready: false, text: 'Загружаем модели в память…' });
        const { loadMs } = await loadEmbeddedSilero();
        if (mounted) setEmbeddedState({ ready: true, text: `Готово. Загрузка моделей: ${loadMs} мс (один раз за запуск приложения).` });
      } catch (error) {
        if (mounted) setEmbeddedState({ ready: false, text: `Не удалось запустить: ${error instanceof Error ? error.message : String(error)}` });
      }
    })();
    return () => { mounted = false; };
  }, [voice]);

  useEffect(() => {
    const candidate = findVoice(voice);
    if (candidate?.kind !== 'device') {
      setDeviceVoice(null);
      return;
    }
    let mounted = true;
    setDeviceVoice(null);
    void inspectDeviceVoice(candidate.engine, candidate.query).then((result) => {
      if (mounted) setDeviceVoice(result);
    }).catch((error) => {
      if (mounted) setDeviceVoice({ available: false, reason: error instanceof Error ? error.message : 'Движок не отвечает' });
    });
    return () => { mounted = false; };
  }, [voice]);

  useEffect(() => {
    if (!ratingsLoaded) return;
    const value = JSON.stringify(ratings);
    saveQueueRef.current = saveQueueRef.current.catch(() => {}).then(() => AsyncStorage.setItem(storageKey, value));
    void saveQueueRef.current.then(() => setStorageError('')).catch(() => {
      setStorageError('Не удалось сохранить оценки на устройстве.');
    });
  }, [ratings, ratingsLoaded]);

  useEffect(() => () => {
    void systemTtsRef.current?.stop();
    void stopDeviceVoice();
    void stopEmbeddedSilero();
  }, []);

  const rate = (criterion: Criterion, score: Score) => {
    if (!ratingsLoaded) return;
    setRatings((current) => ({
      ...current,
      [voice]: { ...current[voice], [criterion]: score },
    }));
  };

  const selectForConversation = async () => {
    try {
      await saveConversationVoiceId(voice);
      setConversationVoice(voice);
    } catch {
      setStorageError('Не удалось сохранить голос для разговора.');
    }
  };

  const stop = async () => {
    if (!busyRef.current) return;
    if (playingVoiceRef.current === 'system') {
      await playbackRef.current?.stop();
    } else if (findVoice(playingVoiceRef.current ?? '')?.kind === 'embedded') {
      await stopEmbeddedSilero();
    } else {
      await stopDeviceVoice();
    }
  };

  const play = async (text: string, phrase: string) => {
    const spokenText = text.trim();
    if (!spokenText || spokenText.length > 500 || busyRef.current) return;
    const candidate = findVoice(voice);
    if (!candidate) return;
    if (candidate.kind === 'device' && !deviceVoice?.available) return;
    if (candidate.kind === 'system' && !hasAndroidTts) return;
    if (candidate.kind === 'embedded' && !embeddedState?.ready) return;

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
      if (candidate.kind === 'system') {
        const startedAt = performance.now();
        if (!systemTtsRef.current) {
          const engine = await loadAndroidTts();
          if (!engine) throw new Error('Системный TTS недоступен');
          await engine.initialize();
          systemTtsRef.current = engine;
        }
        const handle = await systemTtsRef.current.speak({
          text: stripFocusMarks(spokenText),
          locale: 'ru-RU',
          onStart: () => updateRun({
            firstFrameMs: Math.round(performance.now() - startedAt),
            state: 'playing',
          }),
        });
        playbackRef.current = handle;
        const result = await handle.finished;
        updateRun({ state: result });
      } else if (candidate.kind === 'embedded') {
        const result = await playEmbeddedSilero(spokenText, candidate.speaker, ({ firstFrameMs, synthMs, audioMs, accented }) => {
          updateRun({ firstFrameMs, synthMs, audioMs, accented, state: 'playing' });
        });
        updateRun({ state: result });
      } else {
        const result = await playDeviceVoice(candidate.engine, candidate.query, spokenText, newDeviceRequestId(), (firstFrameMs) => {
          updateRun({ firstFrameMs, state: 'playing' });
        });
        updateRun({ state: result });
      }
    } catch (error) {
      updateRun({ state: 'error', error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (hasVoiceMetrics) {
        try {
          const { appPssKb } = await snapshotAppMemory();
          updateRun({ appPssKb });
        } catch { /* Metrics remain unavailable on unsupported builds. */ }
      }
      setHistory((current) => [run, ...current].slice(0, 20));
      playbackRef.current = null;
      playingVoiceRef.current = null;
      busyRef.current = false;
      setBusy(false);
    }
  };

  const candidate = findVoice(voice);
  const canPlay = candidate?.kind === 'system' ? hasAndroidTts
    : candidate?.kind === 'device' ? hasDeviceTts && Boolean(deviceVoice?.available)
    : candidate?.kind === 'embedded' ? Boolean(embeddedState?.ready)
    : false;
  const availability = candidate?.kind === 'embedded' ? (embeddedState?.text ?? 'Проверяем встроенный голос…')
    : candidate?.kind !== 'device' ? ''
    : deviceVoice === null ? 'Проверяем голос на устройстве…'
    : deviceVoice.available
      ? candidate.pack === 'cis_ru'
        ? 'Готово через пакет cis_ru в RuVoice. Он использует вариант v5_cis_base_nostress.'
        : 'Движок и голос готовы.'
      : `${installHint(candidate)} ${deviceVoice.reason}`;

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
          {voiceIds.map((id) => (
            <Pressable
              key={id}
              accessibilityRole="radio"
              accessibilityState={{ checked: voice === id, disabled: busy }}
              disabled={busy}
              onPress={() => setVoice(id)}
              style={[styles.voiceChip, voice === id && styles.selectedChip, busy && styles.disabled]}
            >
              <Text style={styles.chipText}>{voiceLabel(id)}{conversationVoice === id ? ' · в разговоре' : ''}</Text>
            </Pressable>
          ))}
        </View>
        {availability ? <Text accessibilityLiveRegion="polite" style={styles.note}>{availability}</Text> : null}
        {candidate?.kind === 'device' && conversationVoice !== voice && (
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => void selectForConversation()} style={[styles.stopButton, busy && styles.disabled]}>
            <Text style={styles.primaryText}>Использовать в разговоре</Text>
          </Pressable>
        )}

        <Text style={styles.heading}>Тестовые реплики</Text>
        <Text style={styles.note}>Слово в *звёздочках* Silero выделяет логическим ударением (правило RuVoice «Логическое ударение»). Системному TTS звёздочки не передаются.</Text>
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

        {busy && (
          <Pressable accessibilityRole="button" onPress={() => void stop()} style={styles.stopButton}>
            <Text style={styles.primaryText}>Остановить</Text>
          </Pressable>
        )}

        {metrics && (
          <View style={styles.card}>
            <Text style={styles.heading}>Последний запуск · {voiceLabel(metrics.voice)}</Text>
            <Text style={styles.sampleText}>{metrics.phrase}</Text>
            <Text style={styles.metric}>Задержка до начала звука: {metrics.firstFrameMs === undefined ? '—' : `${metrics.firstFrameMs} мс`}</Text>
            {metrics.synthMs !== undefined && (
              <Text style={styles.metric}>Синтез: {metrics.synthMs} мс на {metrics.audioMs} мс звука ({metrics.audioMs ? (metrics.synthMs / metrics.audioMs).toFixed(2) : '—'} от реального времени)</Text>
            )}
            {metrics.accented ? <Text style={styles.note}>Ударения: {metrics.accented}</Text> : null}
            <Text style={styles.metric}>Память процесса iMeet (PSS): {metrics.appPssKb === undefined ? '—' : `${Math.round(metrics.appPssKb / 1024)} МиБ`}</Text>
            <Text style={styles.note}>{metrics.state === 'error' ? `Воспроизведение не удалось: ${metrics.error ?? 'неизвестная ошибка'}` : metrics.state === 'preparing' ? 'Подготавливаем звук…' : metrics.state === 'playing' ? 'Идёт озвучка…' : metrics.state === 'stopped' ? 'Остановлено.' : 'Готово.'}</Text>
            <Text style={styles.note}>{findVoice(metrics.voice)?.kind === 'embedded'
              ? 'Встроенный голос синтезирует фразу целиком внутри iMeet: задержка включает весь синтез, а память моделей входит в PSS iMeet.'
              : 'Время до начала измерено по событию onStart Android TTS: движок синтезирует фразу целиком, поэтому оно включает весь синтез. RuVoice работает в своём процессе, его память в PSS iMeet не входит.'}</Text>
          </View>
        )}

        {history.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.heading}>Последние запуски</Text>
            {history.map((run, index) => (
              <Text key={`${index}-${run.voice}-${run.phrase}`} style={styles.note}>
                {voiceLabel(run.voice)} · {run.phrase}: до звука {run.firstFrameMs === undefined ? '—' : `${run.firstFrameMs} мс`}
              </Text>
            ))}
          </View>
        )}

        <View style={styles.card}>
          <Text style={styles.heading}>Оценка · {voiceLabel(voice)}</Text>
          {criteria.map(({ id, label }) => (
            <View key={id} style={styles.ratingRow}>
              <Text style={styles.ratingLabel}>{label}</Text>
              <View style={styles.scoreRow}>
                {([1, 2, 3, 4, 5] as const).map((score) => (
                  <Pressable
                    key={score}
                    accessibilityLabel={`${label}: ${score} из 5`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: ratings[voice]?.[id] === score, disabled: !ratingsLoaded }}
                    disabled={!ratingsLoaded}
                    onPress={() => rate(id, score)}
                    style={[styles.score, ratings[voice]?.[id] === score && styles.selectedScore]}
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
  backText: { fontFamily: fontFamilies.body, color: colors.buttonHighlight, fontSize: 16 },
  title: { color: colors.white, fontFamily: typography.title.fontFamily, fontSize: 32 },
  description: { fontFamily: fontFamilies.body, color: colors.subtitle, fontSize: 15, lineHeight: 22, marginBottom: 8 },
  heading: { ...typography.heading, color: colors.white, marginTop: 10 },
  voiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  voiceChip: { borderColor: colors.glassBorder, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10 },
  selectedChip: { backgroundColor: colors.infoBackground, borderColor: colors.buttonHighlight },
  chipText: { fontFamily: fontFamilies.body, color: colors.white, fontSize: 15 },
  disabled: { opacity: 0.45 },
  note: { fontFamily: fontFamilies.body, color: colors.subtitle, fontSize: 13, lineHeight: 19 },
  sampleRow: { alignItems: 'center', borderColor: colors.glassBorder, borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 12, padding: 12 },
  sampleCopy: { flex: 1, gap: 4 },
  sampleLabel: { color: colors.buttonHighlight, fontFamily: fontFamilies.control, fontSize: 13 },
  sampleText: { fontFamily: fontFamilies.body, color: colors.white, fontSize: 15, lineHeight: 21 },
  playSmall: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 24, height: 42, justifyContent: 'center', width: 42 },
  playSmallText: { fontFamily: fontFamilies.body, color: colors.white, fontSize: 18 },
  stopButton: { alignItems: 'center', borderColor: colors.glassBorder, borderRadius: 14, borderWidth: 1, padding: 15 },
  primaryText: { color: colors.white, fontFamily: fontFamilies.control, fontSize: 16 },
  card: { backgroundColor: colors.infoBackground, borderRadius: 16, gap: 8, padding: 16 },
  metric: { fontFamily: fontFamilies.body, color: colors.white, fontSize: 15 },
  ratingRow: { gap: 8, marginTop: 6 },
  ratingLabel: { fontFamily: fontFamilies.body, color: colors.subtitle, fontSize: 15 },
  scoreRow: { flexDirection: 'row', gap: 8 },
  score: { alignItems: 'center', borderColor: colors.glassBorder, borderRadius: 10, borderWidth: 1, flex: 1, paddingVertical: 10 },
  selectedScore: { backgroundColor: colors.primary, borderColor: colors.buttonHighlight },
  scoreText: { fontFamily: fontFamilies.body, color: colors.white, fontSize: 15 },
});
