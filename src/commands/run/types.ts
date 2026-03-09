export type {
  RunConfig,
  AgentConfig,
  PromptsConfig,
  LoopConfig,
  ValidationConfig,
  GitConfig,
} from '../../config/schema.js';

export interface AgentResult {
  exitCode: number;
  durationMs: number;
  error?: string | undefined;
  output?: string | undefined;
}

export type RunMode = 'plan' | 'build';

export interface RunOptions {
  max?: number | undefined;
  agent?: string | undefined;
  model?: string | undefined;
  dryRun?: boolean | undefined;
  noCommit?: boolean | undefined;
  noPush?: boolean | undefined;
  resume?: boolean | undefined;
  verbose?: boolean | undefined;
}
