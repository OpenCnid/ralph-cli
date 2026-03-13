import { readFileSync, writeFileSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import type { AgentResult } from './types.js';
import type { AgentConfig, RunConfig } from '../../config/schema.js';
import * as output from '../../utils/output.js';
import {
  computeCalibration,
  detectTrustDrift,
  type CalibrationThresholds,
} from '../score/calibration.js';
import { readResults } from '../score/results.js';

export interface IterationRecord {
  iteration: number;
  durationMs: number;
  exitCode: number;
  commit: string | null;
  error?: string | null | undefined;
}

export interface Checkpoint {
  version: 1;
  phase: 'plan' | 'build';
  startedAt: string;
  iteration: number;
  history: IterationRecord[];
  lastScore?: number | null | undefined;
  lastScoredIteration?: number | null | undefined;
  bestScore?: number | null | undefined;
  consecutiveDiscards?: number | undefined;
  baselineScore?: number | null | undefined;
  baselineCommit?: string | null | undefined;
  bestDiscardedScore?: number | null | undefined;
  lastMetrics?: string | null | undefined;
}

const CHECKPOINT_FILE = '.ralph/run-checkpoint.json';
const RALPH_DIR = '.ralph';

export function loadCheckpoint(): Checkpoint | null {
  let raw: string;
  try {
    raw = readFileSync(CHECKPOINT_FILE, 'utf8');
  } catch {
    return null;
  }

  let parsed: { version?: unknown };
  try {
    parsed = JSON.parse(raw) as { version?: unknown };
  } catch {
    try { unlinkSync(CHECKPOINT_FILE); } catch { /* ignore */ }
    output.warn('Incompatible checkpoint format (version undefined), starting fresh.');
    return null;
  }

  if (parsed.version !== 1) {
    try { unlinkSync(CHECKPOINT_FILE); } catch { /* ignore */ }
    output.warn(`Incompatible checkpoint format (version ${String(parsed.version)}), starting fresh.`);
    return null;
  }

  return parsed as unknown as Checkpoint;
}

export function saveCheckpoint(checkpoint: Checkpoint): void {
  if (!existsSync(RALPH_DIR)) {
    mkdirSync(RALPH_DIR, { recursive: true });
  }
  writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
}

export function deleteCheckpoint(): void {
  try {
    unlinkSync(CHECKPOINT_FILE);
  } catch {
    // no-op if missing
  }
}

export function formatDuration(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  if (totalSecs < 60) {
    return `${totalSecs}s`;
  }
  const totalMins = Math.floor(totalSecs / 60);
  if (totalMins < 60) {
    const remainSecs = totalSecs % 60;
    return `${totalMins}m ${remainSecs}s`;
  }
  const hours = Math.floor(totalMins / 60);
  const remainMins = totalMins % 60;
  return `${hours}h ${remainMins}m`;
}

function getCurrentBranch(): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export function printBanner(
  mode: 'plan' | 'build',
  agentConfig: AgentConfig,
  runConfig: RunConfig,
): void {
  const branch = getCurrentBranch();
  const maxIter = runConfig.loop['max-iterations'];
  const maxIterStr = maxIter === 0 ? 'unlimited' : String(maxIter);

  output.heading('ralph run');
  output.info(`Phase: ${mode}`);
  output.info(`Agent: ${agentConfig.cli} (print)`);
  output.info(`Branch: ${branch}`);
  output.info(`Max iterations: ${maxIterStr}`);
  output.info(`Stall threshold: ${runConfig.loop['stall-threshold']}`);
}

export function printIterationHeader(iteration: number): void {
  output.heading(`── Iteration ${iteration} ──`);
}

export function printIterationSummary(
  _iteration: number,
  result: AgentResult,
  commitHash: string | null,
  task: string | null,
): void {
  output.info(`Duration: ${formatDuration(result.durationMs)}`);
  output.info(`Exit code: ${result.exitCode}`);
  if (task !== null) { // null and undefined are distinct: null = no task detected this iteration
    output.info(`Task: ${task}`);
  }
  if (commitHash !== null) { // null and undefined are distinct: null = no commit made this iteration
    output.info(`Commit: ${commitHash}`);
  }
}

export function printFinalSummary(
  reason: string,
  checkpoint: Checkpoint,
  calibrationThresholds?: CalibrationThresholds | undefined,
): void {
  const { history } = checkpoint;
  const totalMs = history.reduce((sum, r) => sum + r.durationMs, 0);

  // null and undefined are distinct: commit is string | null (null = iteration made no commit)
  const firstCommit = history.find(r => r.commit !== null)?.commit ?? null;
  const lastCommit = [...history].reverse().find(r => r.commit !== null)?.commit ?? null;

  output.heading('Run complete');
  output.info(`Total iterations: ${history.length}`);
  output.info(`Duration: ${formatDuration(totalMs)}`);

  if (firstCommit !== null && lastCommit !== null) { // null = no commits in run history
    if (firstCommit === lastCommit) {
      output.info(`Commit: ${firstCommit}`);
    } else {
      output.info(`Commits: ${firstCommit}..${lastCommit}`);
    }
  }

  output.info(`Stop reason: ${reason}`);

  if (calibrationThresholds !== undefined) {
    const entries = readResults(calibrationThresholds.window);
    if (entries.length >= 5) {
      const report = computeCalibration(entries, calibrationThresholds.window);
      const drift = detectTrustDrift(report, calibrationThresholds);
      const pct = (rate: number) => `${(rate * 100).toFixed(0)}%`;
      const volStr =
        report.scoreVolatility !== null ? report.scoreVolatility.toFixed(3) : 'n/a';
      const statusStr = drift.isDrift ? '' : ' ✓ Normal';
      output.plain(
        `Calibration (last ${report.actual}): pass=${pct(report.passRate)} discard=${pct(report.discardRate)} volatility=${volStr}${statusStr}`,
      );
      if (drift.isDrift) {
        const signalDesc = drift.signals.map(s => s.name.toLowerCase()).join(' + ');
        output.plain(`  ⚠ Trust drift: ${signalDesc}. Run ralph score --calibration for details.`);
      }
    }
  }
}
