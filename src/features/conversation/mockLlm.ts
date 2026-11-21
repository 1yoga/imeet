/**
 * Заглушка LLM на бэкенде: ответ приходит потоком, как будет по SSE/WebSocket.
 * Задержки — типичные для облачной LLM; поменять здесь, чтобы прикинуть другой сервер или модель.
 * Когда появится бэкенд, сюда встанет настоящий поток токенов.
 */
export const mockLlmTiming = {
  /** От отправки текста до первого токена: сеть туда-обратно + очередь + префилл модели. */
  firstTokenMs: 800,
  /** Скорость генерации; токен в русском — примерно пол-слова. */
  tokensPerSecond: 30,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface LlmStreamStats {
  startedAt: number;
  firstTokenAt?: number;
  lastTokenAt?: number;
}

/** Отдаёт готовый ответ по словам с задержками настоящей LLM. */
export async function* streamMockReply(answer: string, stats: LlmStreamStats, isCancelled: () => boolean) {
  await sleep(mockLlmTiming.firstTokenMs);
  const words = answer.match(/\S+\s*/gu) ?? [answer];
  const perWordMs = (2 * 1000) / mockLlmTiming.tokensPerSecond;
  for (const word of words) {
    if (isCancelled()) return;
    stats.firstTokenAt ??= Date.now();
    stats.lastTokenAt = Date.now();
    yield word;
    await sleep(perWordMs);
  }
}
