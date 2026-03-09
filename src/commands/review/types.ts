export type {
  ReviewConfig,
  ReviewContextConfig,
  ReviewOutputConfig,
} from '../../config/schema.js';

export interface ReviewOptions {
  scope?: string | undefined;
  agent?: string | undefined;
  model?: string | undefined;
  format?: string | undefined;
  output?: string | undefined;
  dryRun?: boolean | undefined;
  verbose?: boolean | undefined;
  diffOnly?: boolean | undefined;
}

export interface ReviewContext {
  diff: string;
  diffStat: string;
  changedFiles: string[];
  architecture: string;
  specs: string[];
  rules: string;
  projectName: string;
  scope: string;
  durationMs?: number | undefined;
}
