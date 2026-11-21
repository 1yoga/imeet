import AsyncStorage from '@react-native-async-storage/async-storage';

export type SystemVoice = { id: 'system'; label: string; kind: 'system' };

/** Silero, встроенный в APK (ONNX): работает сразу после установки iMeet. */
export type EmbeddedVoice = { id: string; label: string; kind: 'embedded'; speaker: string };

export type VoiceOption = SystemVoice | EmbeddedVoice;

const embedded = (speaker: string): EmbeddedVoice => ({
  id: `embedded-${speaker}`,
  label: `Silero встроенный · ${speaker}`,
  kind: 'embedded',
  speaker,
});

export const voiceCatalog: readonly VoiceOption[] = [
  embedded('xenia'),
  embedded('kseniya'),
  embedded('baya'),
  embedded('aidar'),
  embedded('eugene'),
  { id: 'system', label: 'Android TextToSpeech', kind: 'system' },
];

/** Голос разговора по умолчанию — встроенный: работает сразу после установки, без RuVoice. */
export const defaultConversationVoiceId = 'embedded-xenia';

export function findVoice(id: string): VoiceOption | undefined {
  return voiceCatalog.find((voice) => voice.id === id);
}

const conversationVoiceKey = '@imeet/conversation-voice-v1';

/** Голос Silero для разговора, выбранный в Voice Lab. */
export async function loadConversationVoiceId() {
  try {
    const stored = await AsyncStorage.getItem(conversationVoiceKey);
    const kind = stored ? findVoice(stored)?.kind : undefined;
    return stored && kind === 'embedded' ? stored : defaultConversationVoiceId;
  } catch {
    return defaultConversationVoiceId;
  }
}

export async function saveConversationVoiceId(id: string) {
  const kind = findVoice(id)?.kind;
  if (kind !== 'embedded') throw new Error('Для разговора выбирается голос Silero');
  await AsyncStorage.setItem(conversationVoiceKey, id);
}
