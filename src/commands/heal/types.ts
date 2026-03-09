export type { HealConfig } from '../../config/schema.js';

export interface HealOptions {
  agent?: string | undefined;
  model?: string | undefined;
  only?: string | undefined;
  skip?: string | undefined;
  dryRun?: boolean | undefined;
  noCommit?: boolean | undefined;
  verbose?: boolean | undefined;
}

export interface DiagnosticResult {
  command: string;
  issues: number;
  output: string;
  exitCode: number;
}

export interface HealContext {
  diagnostics: DiagnosticResult[];
  totalIssues: number;
  projectName: string;
}
