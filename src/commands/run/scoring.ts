import type { ScoreContext } from '../score/types.js';
import type { Checkpoint } from './progress.js';
import type { ScoringConfig } from '../../config/schema.js';

export interface RegressionResult {
  delta: number;
  cumulativeDrop: number;
}

/**
 * Compute per-iteration delta and cumulative drop vs bestScore.
 * Caller must check that checkpoint.lastScore is non-null before calling.
 */
export function computeRegression(
  newScore: number,
  checkpoint: Checkpoint,
  _config: ScoringConfig | undefined,
): RegressionResult {
  const lastScore = checkpoint.lastScore ?? newScore;
  const bestScore = checkpoint.bestScore ?? newScore;
  const delta = newScore - lastScore;
  const cumulativeDrop = bestScore - newScore;
  return { delta, cumulativeDrop };
}

function formatDelta(delta: number): string {
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${delta.toFixed(3)}`;
}

/**
 * Compute a human-readable diff of changed metrics between two key=value strings.
 */
export function computeChangedMetrics(prevMetrics: string, currMetrics: string): string {
  const parseMetrics = (s: string): Record<string, string> => {
    const out: Record<string, string> = {};
    if (!s || s === '—') return out;
    for (const pair of s.split(' ')) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx > 0) {
        out[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
      }
    }
    return out;
  };

  const prev = parseMetrics(prevMetrics);
  const curr = parseMetrics(currMetrics);

  const changes: string[] = [];
  const allKeys = new Set([...Object.keys(prev), ...Object.keys(curr)]);
  for (const key of allKeys) {
    const p = prev[key];
    const c = curr[key];
    if (p !== c) {
      changes.push(`${key}: ${p ?? '—'}→${c ?? '—'}`);
    }
  }

  return changes.length > 0 ? changes.join(', ') : '(none)';
}

/**
 * Generate the {score_context} string for the next iteration's prompt.
 * Returns empty string when previousStatus is null (first iteration).
 */
export function buildScoreContext(ctx: ScoreContext): string {
  const { previousStatus } = ctx;

  if (previousStatus === null) {
    return '';
  }

  if (previousStatus === 'pass') {
    const score = ctx.currentScore != null ? ctx.currentScore.toFixed(3) : '—';
    const prevScore = ctx.previousScore != null ? ctx.previousScore.toFixed(3) : '—';
    const delta = ctx.delta != null ? formatDelta(ctx.delta) : '—';

    let context =
      `## Score Context\n` +
      `Current project score: ${score} (previous: ${prevScore}, delta: ${delta})\n` +
      `Metrics: ${ctx.metrics}\n` +
      `Regressions beyond ${ctx.regressionThreshold} will be auto-reverted.`;

    // Test count monitoring: flag suspicious jumps >100%
    if (
      ctx.currentTestCount !== null &&
      ctx.previousTestCount !== null &&
      ctx.previousTestCount > 0 &&
      ctx.currentTestCount > ctx.previousTestCount * 2
    ) {
      context +=
        `\n⚠ Test count increased significantly (${ctx.previousTestCount} → ${ctx.currentTestCount}). ` +
        `Ensure new tests exercise real behavior.`;
    }

    return context;
  }

  if (previousStatus === 'discard') {
    const prevScore = ctx.previousScore != null ? ctx.previousScore.toFixed(3) : '—';
    const newScore = ctx.currentScore != null ? ctx.currentScore.toFixed(3) : '—';
    const delta = ctx.delta != null ? formatDelta(ctx.delta) : '—';

    return (
      `## Score Context\n` +
      `⚠ Previous iteration was DISCARDED due to score regression (${prevScore} → ${newScore}, delta: ${delta}).\n` +
      `Metrics that changed: ${ctx.changedMetrics}\n` +
      `The codebase has been reverted to the last good state. Try a different approach.`
    );
  }

  if (previousStatus === 'timeout') {
    return (
      `## Score Context\n` +
      `⚠ Previous iteration TIMED OUT after ${ctx.timeoutSeconds}s and was reverted.\n` +
      `Scope your changes more tightly.`
    );
  }

  if (previousStatus === 'fail') {
    return (
      `## Score Context\n` +
      `⚠ Previous iteration FAILED validation and was reverted.\n` +
      `Ensure all tests pass and typecheck succeeds.`
    );
  }

  return '';
}
