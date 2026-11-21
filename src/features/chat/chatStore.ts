import { create } from 'zustand';

export type MessageStatus = 'sending' | 'sent' | 'read' | 'error';

export interface ChatMessage {
  id: string;
  mine: boolean;
  text?: string;
  /** Локальный URI фото (галерея). */
  photoUri?: string;
  sentAt: number;
  status: MessageStatus;
}

interface ChatState {
  threads: Record<string, ChatMessage[]>;
  send: (chatId: string, message: Pick<ChatMessage, 'text' | 'photoUri'>) => void;
  retry: (chatId: string, messageId: string) => void;
}

let counter = 0;

/**
 * Чат прототипа без бэкенда: сообщения живут в памяти. Статусы имитируют доставку —
 * «отправляется» → ✓ «отправлено» → ✓✓ «прочитано», чтобы были видны все состояния макета.
 */
export const useChatStore = create<ChatState>((set, get) => {
  const setStatus = (chatId: string, id: string, status: MessageStatus) =>
    set((state) => ({
      threads: {
        ...state.threads,
        [chatId]: (state.threads[chatId] ?? []).map((m) => (m.id === id ? { ...m, status } : m)),
      },
    }));

  const deliver = (chatId: string, id: string) => {
    setTimeout(() => setStatus(chatId, id, 'sent'), 700);
    setTimeout(() => setStatus(chatId, id, 'read'), 2600);
  };

  return {
    threads: {},
    send: (chatId, content) => {
      counter += 1;
      const message: ChatMessage = { ...content, id: `m${Date.now()}-${counter}`, mine: true, sentAt: Date.now(), status: 'sending' };
      set((state) => ({ threads: { ...state.threads, [chatId]: [...(state.threads[chatId] ?? []), message] } }));
      deliver(chatId, message.id);
    },
    retry: (chatId, messageId) => {
      const message = get().threads[chatId]?.find((m) => m.id === messageId);
      if (!message || message.status !== 'error') return;
      setStatus(chatId, messageId, 'sending');
      deliver(chatId, messageId);
    },
  };
});

export function timeLabel(at: number) {
  const date = new Date(at);
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
}
