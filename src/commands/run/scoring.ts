import type { ScoreContext } from '../score/types.js';
import type { Checkpoint } from './progress.js';
import type { ScoringConfig, RalphConfig } from '../../config/schema.js';
import type { DivergenceItem } from '../gc/fingerprint.js';
import { computeAndRecordDivergence } from '../gc/fingerprint.js';

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

/** Capture divergence info for a passing iteration; swallows errors so the run loop never crashes. */
export function captureDivergence(pr: string, cfg: RalphConfig, i: number, h: string | null): string | undefined {
  try { const it = computeAndRecordDivergence(pr, cfg, i, h ?? ''); return it.length > 0 ? formatDivergenceContext(it) : undefined; }
  catch { return undefined; }
}

/**
 * Format divergence items as an informational string for the score context.
 * Returns undefined when there are no items.
 */
export function formatDivergenceContext(items: DivergenceItem[]): string | undefined {
  if (items.length === 0) return undefined;
  const lines = items.map(item => `  ${item.category}: ${item.detail}`).join('\n');
  return `ℹ Approach divergence detected:\n${lines}`;
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

    if (ctx.adversarialResult != null) {
      const ar = ctx.adversarialResult;
      if (ar.outcome === 'pass') {
        const n = ar.testFilesAdded.length;
        context += `\nAdversarial testing passed: ${n} edge-case tests added and passing.`;
      } else if (ar.outcome === 'skip') {
        const reason = ar.skipReason ?? 'unknown';
        context += `\nAdversarial testing: skipped (${reason}).`;
      }
    }

    if (ctx.divergenceInfo) {
      context += '\n\n' + ctx.divergenceInfo;
    }

    return context;
  }

  if (previousStatus === 'adversarial-fail') {
    const r = ctx.adversarialResult;
    const count = r?.failedTests.length ?? 0;
    const failedList = (r?.failedTests ?? []).map(t => `  - test: "${t}"`).join('\n');
    const branch = r?.diagnosticBranch ?? null;
    return (
      `## Score Context\n` +
      `⚠ Previous iteration passed validation but was REVERTED by adversarial testing.\n` +
      `The adversary found ${count} edge case(s) that broke the implementation.\n` +
      (failedList ? `Failed tests:\n${failedList}\n` : '') +
      (branch ? `Diagnostic branch: ${branch}\n` : '') +
      `Fix these edge cases in your implementation. The adversarial tests will run again.`
    );
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
    const { failedStage, stageResults } = ctx;
    const entries = stageResults ? stageResults.split(',') : [];

    if (stageResults && entries.length >= 2 && failedStage) {
      const formatted = entries
        .map(part => {
          const colonIdx = part.lastIndexOf(':');
          if (colonIdx < 0) return part;
          const name = part.slice(0, colonIdx);
          const status = part.slice(colonIdx + 1);
          if (status === 'pass') return `${name} ✓`;
          if (status === 'fail') return `${name} ✗`;
          if (status === 'skip') return `${name} ⊘`;
          return part;
        })
        .join(' | ');

      const passingNames = entries
        .filter(part => part.endsWith(':pass'))
        .map(part => part.slice(0, part.lastIndexOf(':')));

      let fixLine = `Fix the ${failedStage} failures.`;
      if (passingNames.length > 0) {
        const list =
          passingNames.length === 1
            ? passingNames[0]
            : passingNames.slice(0, -1).join(', ') + ' and ' + passingNames[passingNames.length - 1];
        fixLine += ` ${list} ${passingNames.length === 1 ? 'is' : 'are'} passing — do not change them.`;
      }

      return (
        `## Score Context\n` +
        `⚠ Previous iteration FAILED validation at stage "${failedStage}" and was reverted.\n` +
        `Stage results: ${formatted}\n` +
        fixLine
      );
    }

    return (
      `## Score Context\n` +
      `⚠ Previous iteration FAILED validation and was reverted.\n` +
      `Ensure all tests pass and typecheck succeeds.`
    );
  }

  return '';
}
