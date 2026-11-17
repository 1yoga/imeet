import type { AudioChunk, TranscriptSegment } from '../voice/contracts';

export type AgentConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

export interface AgentSessionContext {
  sessionId?: string;
  locale?: string;
  userId?: string;
}

export type AgentEvent =
  | { type: 'connection'; state: AgentConnectionState }
  | { type: 'user-transcript'; segment: TranscriptSegment }
  | { type: 'assistant-text'; text: string; isFinal: boolean }
  | { type: 'assistant-audio'; chunk: AudioChunk }
  | { type: 'error'; error: Error };

/** Transport boundary for a future server-side conversational AI agent. */
export interface ServerAiAgentClient {
  readonly id: 'server-ai-agent';
  connect(context?: AgentSessionContext): Promise<void>;
  disconnect(): Promise<void>;
  sendText(text: string): Promise<void>;
  sendAudio(chunk: AudioChunk): Promise<void>;
  onEvent(listener: (event: AgentEvent) => void): () => void;
}
