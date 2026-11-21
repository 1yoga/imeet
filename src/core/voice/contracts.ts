export interface TtsRequest {
  text: string;
  voice?: string;
  locale?: string;
  speed?: number;
  onStart?: () => void;
}

export interface TtsStreamRequest {
  /** Порции текста по мере готовности; когда перебор закончился — реплика закончилась. */
  chunks: AsyncIterable<string>;
  onStart?: () => void;
}

export interface TtsPlaybackHandle {
  /** Completes only when playback has ended or been interrupted. */
  finished: Promise<'completed' | 'stopped'>;
  stop(): Promise<void>;
}

/** Adapter boundary for a future native or server-backed TTS implementation. */
export interface TtsEngine {
  readonly id: string;
  initialize(): Promise<void>;
  speak(request: TtsRequest): Promise<TtsPlaybackHandle>;
  /**
   * Потоковая озвучка: текст приходит порциями (ответ LLM), звук начинается с первой порции.
   * Есть только у встроенного голоса.
   */
  speakStream?(request: TtsStreamRequest): TtsPlaybackHandle;
  stop(): Promise<void>;
  dispose(): Promise<void>;
}
