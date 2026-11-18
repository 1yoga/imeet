export type AudioEncoding = 'pcm_s16le' | 'opus';

export interface AudioFormat {
  sampleRate: number;
  channels: number;
  encoding: AudioEncoding;
}

export interface AudioChunk {
  data: ArrayBuffer;
  timestampMs: number;
  format: AudioFormat;
}

export interface TranscriptSegment {
  text: string;
  isFinal: boolean;
  confidence?: number;
  language?: string;
}

/** Adapter boundary for a future GigaAM v3 implementation. */
export interface AsrEngine {
  readonly id: string;
  initialize(options?: { modelPath?: string }): Promise<void>;
  start(options?: { language?: string }): Promise<void>;
  pushAudio(chunk: AudioChunk): Promise<void>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
  onTranscript(listener: (segment: TranscriptSegment) => void): () => void;
}

export interface GigaAmV3AsrEngine extends AsrEngine {
  readonly id: 'gigaam-v3';
}

export type VadEvent =
  | { type: 'speech-start'; timestampMs: number }
  | { type: 'speech-end'; timestampMs: number };

/** Adapter boundary for a future Silero VAD implementation. */
export interface VadEngine {
  readonly id: string;
  initialize(options?: { modelPath?: string }): Promise<void>;
  processAudio(chunk: AudioChunk): Promise<VadEvent | null>;
  reset(): void;
  dispose(): Promise<void>;
  onEvent(listener: (event: VadEvent) => void): () => void;
}

export interface SileroVadEngine extends VadEngine {
  readonly id: 'silero-vad';
}

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
