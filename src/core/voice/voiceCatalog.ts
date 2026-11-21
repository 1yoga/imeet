import AsyncStorage from '@react-native-async-storage/async-storage';

/** Android TTS-движок RuVoice: https://github.com/kost-t-human/ruvoice-tts */
export const RUVOICE_ENGINE = 'ru.kost.ruvoice';

export type VoicePack = 'ru' | 'cis_ru';

export type DeviceVoice = {
  id: string;
  label: string;
  kind: 'device';
  engine: string;
  /** Имя голоса в TTS API RuVoice: голос, язык, пак (`xenia-ru`, `saida-ru-cis`). */
  query: string;
  pack: VoicePack;
};

export type SystemVoice = { id: 'system'; label: string; kind: 'system' };

export type VoiceOption = DeviceVoice | SystemVoice;

const silero55 = (speaker: string): DeviceVoice => ({
  id: `silero55-${speaker}`,
  label: `Silero v5_5_ru · ${speaker}`,
  kind: 'device',
  engine: RUVOICE_ENGINE,
  query: `${speaker}-ru`,
  pack: 'ru',
});

const cisBase = (speaker: string): DeviceVoice => ({
  id: `cis-base-ru_${speaker}`,
  label: `Silero v5_cis_base · ru_${speaker}`,
  kind: 'device',
  engine: RUVOICE_ENGINE,
  query: `${speaker}-ru-cis`,
  pack: 'cis_ru',
});

export const voiceCatalog: readonly VoiceOption[] = [
  silero55('xenia'),
  silero55('kseniya'),
  silero55('baya'),
  silero55('aidar'),
  silero55('eugene'),
  cisBase('saida'),
  cisBase('zinaida'),
  cisBase('eduard'),
  { id: 'system', label: 'Android TextToSpeech', kind: 'system' },
];

export const defaultConversationVoiceId = 'silero55-xenia';

export function findVoice(id: string): VoiceOption | undefined {
  return voiceCatalog.find((voice) => voice.id === id);
}

export function findDeviceVoice(id: string): DeviceVoice {
  const voice = findVoice(id);
  if (voice?.kind === 'device') return voice;
  return findVoice(defaultConversationVoiceId) as DeviceVoice;
}

/** Что установить на телефон, если голос недоступен. */
export function installHint(voice: DeviceVoice) {
  switch (voice.pack) {
    case 'cis_ru':
      return 'Нужен RuVoice TTS с паком cis_ru.';
    default:
      return 'Нужен RuVoice TTS со штатными голосами.';
  }
}

const conversationVoiceKey = '@imeet/conversation-voice-v1';

/** Голос Silero для разговора, выбранный в Voice Lab. */
export async function loadConversationVoiceId() {
  try {
    const stored = await AsyncStorage.getItem(conversationVoiceKey);
    return stored && findVoice(stored)?.kind === 'device' ? stored : defaultConversationVoiceId;
  } catch {
    return defaultConversationVoiceId;
  }
}

export async function saveConversationVoiceId(id: string) {
  if (findVoice(id)?.kind !== 'device') throw new Error('Для разговора выбирается голос Silero');
  await AsyncStorage.setItem(conversationVoiceKey, id);
}
