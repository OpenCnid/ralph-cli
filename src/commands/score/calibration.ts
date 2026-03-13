import type { ResultEntry } from './types.js';
import { renderSparkline } from './trend.js';

export interface CalibrationReport {
  window: number;                       // configured window size
  actual: number;                       // actual entries analyzed (may be < window)
  passRate: number;                     // 0.0–1.0
  discardRate: number;                  // 0.0–1.0
  adversarialCatchRate: number | null;  // null if no adversarial-fail entries
  firstTryPassRate: number;             // 0.0–1.0 (heuristic)
  scoreVolatility: number | null;       // null if < 2 scored entries
  stallFrequency: number | null;        // null if no stall entries in results.tsv
  scores: (number | null)[];            // raw scores for sparkline
  partial: boolean;                     // true when actual < window
}

export interface TrustDriftSignal {
  name: string;          // e.g., "High pass rate"
  value: string;         // e.g., "97%"
  threshold: string;     // e.g., "> 95%"
  interpretation: string;
}

export interface TrustDriftResult {
  isDrift: boolean;
  signals: TrustDriftSignal[];
}

export interface CalibrationThresholds {
  window: number;
  warnPassRate: number;
  warnDiscardRate: number;
  warnVolatility: number;
}

const MIN_DATA_THRESHOLD = 5;

/** Compute calibration metrics from the last `window` entries in results.tsv. */
export function computeCalibration(
  entries: ResultEntry[],
  window: number,
): CalibrationReport {
  // Insufficient data — caller checks actual < 5
  if (entries.length < MIN_DATA_THRESHOLD) {
    return {
      window,
      actual: entries.length,
      passRate: 0,
      discardRate: 0,
      adversarialCatchRate: null,
      firstTryPassRate: 0,
      scoreVolatility: null,
      stallFrequency: null,
      scores: entries.map(e => e.score),
      partial: entries.length < window,
    };
  }

  const actual = entries.length;
  const passes = entries.filter(e => e.status === 'pass').length;
  const discards = entries.filter(e => e.status === 'discard').length;

  // adversarial-fail is a Phase 2 status type; check via string comparison until
  // Phase 2 updates the ResultEntry status type union (F-CT07)
  const adversarialFails = entries.filter(
    e => (e.status as string) === 'adversarial-fail',
  ).length;

  // 'stall' is not yet in the ResultEntry status union — using string comparison until
  // the run loop is updated to write stall status entries (prerequisite documented in spec)
  const stalls = entries.filter(e => (e.status as string) === 'stall').length;

  const passRate = passes / actual;
  const discardRate = discards / actual;

  // Adversarial catch rate: null when no adversarial-fail entries exist
  const adversarialCatchRate =
    adversarialFails > 0
      ? adversarialFails / (passes + adversarialFails)
      : null;

  // Stall frequency: null when no stall entries exist
  const stallFrequency = stalls > 0 ? stalls / actual : null;

  // First-try pass rate heuristic:
  // Entry[0] is always first-try. Entry[i > 0] is first-try iff entry[i-1].status === 'pass'.
  // Limitation: does not track task identity — if plan A passes and plan B starts,
  // the first iteration of plan B is treated as first-try.
  let firstTryTotal = 0;
  let firstTryPasses = 0;
  for (let i = 0; i < entries.length; i++) {
    const isFirstTry = i === 0 || entries[i - 1]!.status === 'pass';
    if (isFirstTry) {
      firstTryTotal++;
      if (entries[i]!.status === 'pass') firstTryPasses++;
    }
  }
  const firstTryPassRate = firstTryTotal > 0 ? firstTryPasses / firstTryTotal : 0;

  // Score volatility: population stddev of non-null scores; null if < 2 scored
  const nonNullScores = entries.map(e => e.score).filter((s): s is number => s !== null);
  let scoreVolatility: number | null = null;
  if (nonNullScores.length >= 2) {
    const mean = nonNullScores.reduce((a, b) => a + b, 0) / nonNullScores.length;
    const variance =
      nonNullScores.reduce((sum, s) => sum + (s - mean) ** 2, 0) / nonNullScores.length;
    scoreVolatility = Math.sqrt(variance);
  }

  return {
    window,
    actual,
    passRate,
    discardRate,
    adversarialCatchRate,
    firstTryPassRate,
    scoreVolatility,
    stallFrequency,
    scores: entries.map(e => e.score),
    partial: actual < window,
  };
}

/** Detect trust drift from calibration metrics. Requires 2+ signals to fire. */
export function detectTrustDrift(
  report: CalibrationReport,
  thresholds: CalibrationThresholds,
): TrustDriftResult {
  const signals: TrustDriftSignal[] = [];

  if (report.passRate > thresholds.warnPassRate) {
    signals.push({
      name: 'High pass rate',
      value: `${(report.passRate * 100).toFixed(0)}%`,
      threshold: `> ${(thresholds.warnPassRate * 100).toFixed(0)}%`,
      interpretation: 'Validation may not be catching subtle issues',
    });
  }

  // Inverted check: low discard rate is suspicious (agent never abandons bad iterations)
  if (report.discardRate < thresholds.warnDiscardRate) {
    signals.push({
      name: 'Low discard rate',
      value: `${(report.discardRate * 100).toFixed(0)}%`,
      threshold: `< ${(thresholds.warnDiscardRate * 100).toFixed(0)}%`,
      interpretation: 'Iterations are rarely being discarded; validation may be too lenient',
    });
  }

  // Skip if null (< 2 scored entries)
  if (report.scoreVolatility !== null && report.scoreVolatility < thresholds.warnVolatility) {
    signals.push({
      name: 'Low score volatility',
      value: report.scoreVolatility.toFixed(3),
      threshold: `< ${thresholds.warnVolatility.toFixed(3)}`,
      interpretation: 'Scores are barely changing; work may have stagnated',
    });
  }

  // Skip if null (no adversarial-fail entries) — adversarial signal only fires when data exists
  if (report.adversarialCatchRate !== null && report.adversarialCatchRate === 0) {
    signals.push({
      name: 'Low adversarial catch rate',
      value: '0%',
      threshold: '= 0%',
      interpretation: 'Adversarial inputs are not being caught; adversarial generation may not be effective',
    });
  }

  // Stall frequency is NOT a drift signal (operational issue, not a validation calibration issue)

  return {
    isDrift: signals.length >= 2,
    signals,
  };
}

/** Format calibration report for terminal output. */
export function formatCalibrationReport(
  report: CalibrationReport,
  drift: TrustDriftResult,
): string {
  const lines: string[] = [];

  const pct = (rate: number) => `${(rate * 100).toFixed(1)}%`;

  // Header — show partial window label when actual < window
  if (report.actual < report.window) {
    lines.push(
      `Calibration Report (${report.actual} of ${report.window} iterations — partial window)`,
    );
  } else {
    lines.push(`Calibration Report (last ${report.actual} iterations)`);
  }
  lines.push('─'.repeat(41));

  // Pass rate and discard rate with count/total
  const passCount = Math.round(report.passRate * report.actual);
  const discardCount = Math.round(report.discardRate * report.actual);
  lines.push(`Pass rate:           ${passCount}/${report.actual}  ${pct(report.passRate)}`);
  lines.push(`Discard rate:        ${discardCount}/${report.actual}  ${pct(report.discardRate)}`);
  lines.push(`First-try pass rate: ${pct(report.firstTryPassRate)}`);

  if (report.scoreVolatility !== null) {
    lines.push(`Score volatility:    ${report.scoreVolatility.toFixed(3)}`);
  } else {
    lines.push(`Score volatility:    unavailable (insufficient scored entries)`);
  }

  if (report.stallFrequency !== null) {
    lines.push(`Stall frequency:     ${pct(report.stallFrequency)}`);
  } else {
    lines.push(`Stall frequency:     unavailable (no stall entries recorded)`);
  }

  // Adversarial line omitted entirely when null
  if (report.adversarialCatchRate !== null) {
    lines.push(`Adversarial catch rate: ${pct(report.adversarialCatchRate)}`);
  }

  // Sparkline
  lines.push('');
  const sparkline = renderSparkline(report.scores);
  if (sparkline) {
    lines.push(`Score trend: ${sparkline}`);
    lines.push('');
  }

  // Trust status
  if (drift.isDrift) {
    lines.push(`Trust status: ⚠ Drift (${drift.signals.length} signals)`);
    for (const signal of drift.signals) {
      lines.push(`  ${signal.name}: ${signal.value} (threshold: ${signal.threshold})`);
    }
    lines.push('');
    lines.push('  Suggested actions:');
    lines.push('  - Run `ralph gc --json` and compare drift item counts to previous run');
    lines.push('  - Review the last 5 commits manually for subtle issues');
    lines.push(
      '  - Consider lowering warn-pass-rate if high pass rates are expected for this project',
    );
  } else {
    lines.push('Trust status: ✓ Normal');
    lines.push('  All calibration metrics within expected ranges.');
  }

  return lines.join('\n');
}

/** Format calibration report as structured JSON. */
export function formatCalibrationJSON(
  report: CalibrationReport,
  drift: TrustDriftResult,
): object {
  // Insufficient data — return error object
  if (report.actual < MIN_DATA_THRESHOLD) {
    return {
      calibration: null,
      error: 'insufficient data',
      entries: report.actual,
      minimum: MIN_DATA_THRESHOLD,
    };
  }

  return {
    calibration: {
      window: report.window,
      actual: report.actual,
      passRate: report.passRate,
      discardRate: report.discardRate,
      adversarialCatchRate: report.adversarialCatchRate,
      firstTryPassRate: report.firstTryPassRate,
      scoreVolatility: report.scoreVolatility,
      stallFrequency: report.stallFrequency,
      partial: report.partial,
    },
    trustDrift: {
      isDrift: drift.isDrift,
      signals: drift.signals,
    },
    timestamp: new Date().toISOString(),
  };
}
