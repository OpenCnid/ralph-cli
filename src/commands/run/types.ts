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
  timedOut?: boolean | undefined;
}

export type RunMode = 'plan' | 'build';

export type AdversarialOutcome = 'pass' | 'fail' | 'skip';

export interface AdversarialResult {
  outcome: AdversarialOutcome;
  testFilesAdded: string[];
  failedTests: string[];
  diagnosticBranch: string | null;
  testCountBefore: number | null;
  testCountAfter: number | null;
  skipReason?: string | undefined;
}

export interface RunOptions {
  max?: number | undefined;
  agent?: string | undefined;
  model?: string | undefined;
  dryRun?: boolean | undefined;
  noCommit?: boolean | undefined;
  noPush?: boolean | undefined;
  resume?: boolean | undefined;
  verbose?: boolean | undefined;
  noScore?: boolean | undefined;
  simplify?: boolean | undefined;
  baselineScore?: number | undefined;
  force?: boolean | undefined;
}
