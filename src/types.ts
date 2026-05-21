export type AgentType =
  | 'audio-processor'
  | 'primary-transcriber'
  | 'secondary-verifier'
  | 'text-processor'
  | 'ai-router'
  | 'speaker-diarizer'
  | 'content-analyzer'
  | 'export-formatter';

export type AgentStatus = 'idle' | 'loading' | 'running' | 'error';

export interface AgentMetrics {
  name: AgentType;
  displayName: string;
  status: AgentStatus;
  latencyMs: number;
  processedCount: number;
  cpuUsage: number;
  memoryUsageMb: number;
}

export type SegmentState = 'raw' | 'formatted' | 'enhanced' | 'final';

export interface TranscriptSegment {
  id: string;
  timestampStart: number; // in seconds from start
  timestampEnd: number;
  speaker: string;
  text: {
    raw: string;
    formatted?: string;
    aiEnhanced?: string;
  };
  confidence: number;
  state: SegmentState;
  processingTimeMs?: number;
}

export interface EventBusMessage<T = any> {
  eventType: string;
  payload: T;
  timestamp: string; // ISO string
  source: string;
  correlationId: string;
}

export type AIProcessingMode = 'local' | 'cloud' | 'auto';
export type ResourceProfile = 'lite' | 'standard' | 'pro';

export interface UserPreferences {
  aiMode: AIProcessingMode;
  resourceProfile: ResourceProfile;
  fillerWordRemoval: boolean;
  numberFormatting: boolean;
  punctuationInsertion: boolean;
  capitalization: boolean;
  openaiKey: string;
  anthropicKey: string;
  geminiKey: string;
  fillerWords: string[];
  acronyms: Record<string, string>;
  properNouns: string[];
}

export interface TelemetryData {
  cpuUsage: number;
  memoryUsageMb: number;
  activeAgents: number;
  latencyMs: number;
  recordingDurationSec: number;
}
