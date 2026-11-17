import type { ServerAiAgentClient } from '../agent/contracts';
import type {
  GigaAmV3AsrEngine,
  SileroVadEngine,
  TtsEngine,
} from '../voice/contracts';

/** Dependency-injection boundary for the production voice runtime. */
export interface AppServices {
  asr: GigaAmV3AsrEngine;
  vad: SileroVadEngine;
  tts: TtsEngine;
  agent: ServerAiAgentClient;
}
