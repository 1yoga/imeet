export interface TtsRequest {
  text: string;
  voice?: string;
  locale?: string;
  speed?: number;
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
  stop(): Promise<void>;
  dispose(): Promise<void>;
}
