import AsyncStorage from '@react-native-async-storage/async-storage';

export interface ConversationSettings {
  /** Сколько секунд тишины считать концом реплики пользователя (VAD). */
  endOfPhraseSec: number;
  /** Сколько секунд агент молчит после распознавания, прежде чем ответить. */
  replyDelaySec: number;
  /**
   * Пауза внутри реплики, после которой агент вставляет короткую реакцию («Понятно», «Ага»),
   * не перебивая. 0 — выключено. Всегда меньше паузы конца фразы.
   */
  backchannelPauseSec: number;
  /** Можно перебить агента голосом: микрофон слушает, пока агент говорит. */
  bargeIn: boolean;
}

export const settingLimits = {
  // «Наслух» ограничивает конец фразы тремя секундами.
  endOfPhraseSec: { min: 0.8, max: 3, step: 0.1 },
  replyDelaySec: { min: 0, max: 2, step: 0.1 },
  // 0 — выкл; иначе от 0,5 с.
  backchannelPauseSec: { min: 0, max: 2.5, step: 0.1 },
} as const;

/** Короткая реакция должна наступать заметно раньше конца фразы. */
const BACKCHANNEL_GAP_SEC = 0.4;
const BACKCHANNEL_MIN_SEC = 0.5;

export const defaultConversationSettings: ConversationSettings = {
  endOfPhraseSec: 2.5,
  replyDelaySec: 0,
  backchannelPauseSec: 1,
  bargeIn: true,
};

const key = '@imeet/conversation-settings-v1';

const clamp = (value: unknown, { min, max }: { min: number; max: number }, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.min(max, Math.max(min, value)) * 10) / 10
    : fallback;

export function normalizeSettings(raw: Partial<ConversationSettings>): ConversationSettings {
  const endOfPhraseSec = clamp(raw.endOfPhraseSec, settingLimits.endOfPhraseSec, defaultConversationSettings.endOfPhraseSec);
  let backchannelPauseSec = clamp(
    raw.backchannelPauseSec,
    settingLimits.backchannelPauseSec,
    defaultConversationSettings.backchannelPauseSec,
  );
  if (backchannelPauseSec > 0) {
    const max = Math.round((endOfPhraseSec - BACKCHANNEL_GAP_SEC) * 10) / 10;
    backchannelPauseSec = max < BACKCHANNEL_MIN_SEC ? 0 : Math.min(Math.max(backchannelPauseSec, BACKCHANNEL_MIN_SEC), max);
  }
  return {
    endOfPhraseSec,
    replyDelaySec: clamp(raw.replyDelaySec, settingLimits.replyDelaySec, defaultConversationSettings.replyDelaySec),
    backchannelPauseSec,
    bargeIn: typeof raw.bargeIn === 'boolean' ? raw.bargeIn : defaultConversationSettings.bargeIn,
  };
}

/** Верхняя граница паузы до короткой реплики при текущем конце фразы. */
export function backchannelMaxSec(endOfPhraseSec: number) {
  return Math.max(0, Math.round((endOfPhraseSec - BACKCHANNEL_GAP_SEC) * 10) / 10);
}

export async function loadConversationSettings(): Promise<ConversationSettings> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? normalizeSettings(JSON.parse(raw)) : defaultConversationSettings;
  } catch {
    return defaultConversationSettings;
  }
}

export async function saveConversationSettings(settings: ConversationSettings) {
  await AsyncStorage.setItem(key, JSON.stringify(normalizeSettings(settings)));
}
