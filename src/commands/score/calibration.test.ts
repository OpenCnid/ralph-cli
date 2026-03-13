import { describe, it, expect } from 'vitest';
import {
  computeCalibration,
  detectTrustDrift,
  formatCalibrationReport,
  formatCalibrationJSON,
} from './calibration.js';
import type { CalibrationReport, CalibrationThresholds, TrustDriftResult } from './calibration.js';
import type { ResultEntry } from './types.js';

// Default thresholds matching DEFAULT_CALIBRATION
const DEFAULT_THRESHOLDS: CalibrationThresholds = {
  window: 30,
  warnPassRate: 0.95,
  warnDiscardRate: 0.01,
  warnVolatility: 0.005,
};

function makeEntry(overrides: Partial<ResultEntry> = {}): ResultEntry {
  return {
    commit: 'abc1234',
    iteration: 1,
    status: 'pass',
    score: 0.8,
    delta: 0.0,
    durationS: 30,
    metrics: 'tests=10',
    description: 'ralph: task 1',
    ...overrides,
  };
}

function makeEntries(
  statuses: Array<ResultEntry['status'] | 'stall'>,
  score: number | null = 0.8,
): ResultEntry[] {
  return statuses.map((status, i) =>
    makeEntry({ iteration: i + 1, status: status as ResultEntry['status'], score }),
  );
}

// ─── computeCalibration ─────────────────────────────────────────────────────

describe('computeCalibration()', () => {
  it('mixed statuses — correct rates', () => {
    // 20 pass, 5 fail, 3 discard, 2 timeout
    const entries = [
      ...Array(20).fill(null).map((_, i) => makeEntry({ iteration: i + 1, status: 'pass' })),
      ...Array(5).fill(null).map((_, i) => makeEntry({ iteration: 21 + i, status: 'fail' })),
      ...Array(3).fill(null).map((_, i) => makeEntry({ iteration: 26 + i, status: 'discard' })),
      ...Array(2).fill(null).map((_, i) => makeEntry({ iteration: 29 + i, status: 'timeout' })),
    ];
    const report = computeCalibration(entries, 30);

    expect(report.actual).toBe(30);
    expect(report.window).toBe(30);
    expect(report.passRate).toBeCloseTo(20 / 30);
    expect(report.discardRate).toBeCloseTo(3 / 30);
    expect(report.partial).toBe(false);
  });

  it('all passes — 100% pass rate, 0% discard rate', () => {
    const entries = Array(10).fill(null).map((_, i) => makeEntry({ iteration: i + 1 }));
    const report = computeCalibration(entries, 30);

    expect(report.passRate).toBe(1);
    expect(report.discardRate).toBe(0);
    expect(report.actual).toBe(10);
    expect(report.partial).toBe(true);
  });

  it('all failures — 0% pass rate', () => {
    const entries = Array(10)
      .fill(null)
      .map((_, i) => makeEntry({ iteration: i + 1, status: 'fail' }));
    const report = computeCalibration(entries, 30);

    expect(report.passRate).toBe(0);
    expect(report.discardRate).toBe(0);
  });

  it('exactly 5 entries — computes (minimum threshold)', () => {
    const entries = Array(5).fill(null).map((_, i) => makeEntry({ iteration: i + 1 }));
    const report = computeCalibration(entries, 30);

    expect(report.actual).toBe(5);
    expect(report.passRate).toBe(1);
  });

  it('4 entries — insufficient data (all rates 0, nulls for conditional metrics)', () => {
    const entries = Array(4).fill(null).map((_, i) => makeEntry({ iteration: i + 1 }));
    const report = computeCalibration(entries, 30);

    expect(report.actual).toBe(4);
    expect(report.passRate).toBe(0);
    expect(report.discardRate).toBe(0);
    expect(report.scoreVolatility).toBeNull();
    expect(report.adversarialCatchRate).toBeNull();
    expect(report.stallFrequency).toBeNull();
  });

  it('all scores identical — volatility = 0', () => {
    const entries = Array(10)
      .fill(null)
      .map((_, i) => makeEntry({ iteration: i + 1, score: 0.5 }));
    const report = computeCalibration(entries, 30);

    expect(report.scoreVolatility).toBe(0);
  });

  it('two scored entries — volatility computed', () => {
    const entries = [
      makeEntry({ score: 0.4 }),
      makeEntry({ score: 0.8 }),
      makeEntry({ score: null }),
      makeEntry({ score: null }),
      makeEntry({ score: null }),
    ];
    const report = computeCalibration(entries, 30);

    // stddev of [0.4, 0.8]: mean=0.6, variance=((0.04+0.04)/2)=0.04, stddev=0.2
    expect(report.scoreVolatility).toBeCloseTo(0.2);
  });

  it('all scores null — volatility = null', () => {
    const entries = Array(5)
      .fill(null)
      .map((_, i) => makeEntry({ iteration: i + 1, score: null }));
    const report = computeCalibration(entries, 30);

    expect(report.scoreVolatility).toBeNull();
  });

  it('one non-null score — volatility = null (need >= 2)', () => {
    const entries = [
      makeEntry({ score: 0.8 }),
      makeEntry({ score: null }),
      makeEntry({ score: null }),
      makeEntry({ score: null }),
      makeEntry({ score: null }),
    ];
    const report = computeCalibration(entries, 30);

    expect(report.scoreVolatility).toBeNull();
  });

  it('stall entries present — stallFrequency computed', () => {
    const entries = [
      makeEntry({ status: 'pass' }),
      makeEntry({ status: 'pass' }),
      makeEntry({ status: 'stall' as ResultEntry['status'] }),
      makeEntry({ status: 'pass' }),
      makeEntry({ status: 'stall' as ResultEntry['status'] }),
    ];
    const report = computeCalibration(entries, 30);

    expect(report.stallFrequency).toBeCloseTo(2 / 5);
  });

  it('no stall entries — stallFrequency = null', () => {
    const entries = Array(5).fill(null).map((_, i) => makeEntry({ iteration: i + 1 }));
    const report = computeCalibration(entries, 30);

    expect(report.stallFrequency).toBeNull();
  });

  it('adversarial-fail entries present — adversarialCatchRate computed', () => {
    const entries = [
      makeEntry({ status: 'pass' }),
      makeEntry({ status: 'pass' }),
      makeEntry({ status: 'adversarial-fail' }),
      makeEntry({ status: 'adversarial-fail' }),
      makeEntry({ status: 'pass' }),
    ];
    const report = computeCalibration(entries, 30);

    // 2 adversarial-fail / (3 passes + 2 adversarial-fail) = 2/5 = 0.4
    expect(report.adversarialCatchRate).toBeCloseTo(2 / 5);
  });

  it('no adversarial entries — adversarialCatchRate = null', () => {
    const entries = Array(5).fill(null).map((_, i) => makeEntry({ iteration: i + 1 }));
    const report = computeCalibration(entries, 30);

    expect(report.adversarialCatchRate).toBeNull();
  });

  it('first-try heuristic: pass/pass/fail/pass/pass → first-try pass rate = 75%', () => {
    // Entry 0: first-try (always), status=pass → first-try pass
    // Entry 1: prev=pass → first-try, status=pass → first-try pass
    // Entry 2: prev=pass → first-try, status=fail → first-try non-pass
    // Entry 3: prev=fail → retry (not first-try)
    // Entry 4: prev=pass → first-try, status=pass → first-try pass
    // First-try: 0, 1, 2, 4 (4 total), passes: 0, 1, 4 (3 total) → 3/4 = 75%
    const entries = [
      makeEntry({ status: 'pass' }),
      makeEntry({ status: 'pass' }),
      makeEntry({ status: 'fail' }),
      makeEntry({ status: 'pass' }),
      makeEntry({ status: 'pass' }),
    ];
    const report = computeCalibration(entries, 30);

    expect(report.firstTryPassRate).toBeCloseTo(3 / 4);
  });

  it('partial window — partial=true when actual < window', () => {
    const entries = Array(12).fill(null).map((_, i) => makeEntry({ iteration: i + 1 }));
    const report = computeCalibration(entries, 30);

    expect(report.partial).toBe(true);
    expect(report.actual).toBe(12);
    expect(report.window).toBe(30);
  });

  it('full window — partial=false when actual >= window', () => {
    const entries = Array(30).fill(null).map((_, i) => makeEntry({ iteration: i + 1 }));
    const report = computeCalibration(entries, 30);

    expect(report.partial).toBe(false);
  });

  it('scores field contains raw scores from entries', () => {
    const scores = [0.1, 0.5, null, 0.9, 0.7];
    const entries = scores.map((score, i) => makeEntry({ iteration: i + 1, score }));
    const report = computeCalibration(entries, 30);

    expect(report.scores).toEqual(scores);
  });
});

// ─── detectTrustDrift ───────────────────────────────────────────────────────

function makeReport(overrides: Partial<CalibrationReport> = {}): CalibrationReport {
  return {
    window: 30,
    actual: 30,
    passRate: 0.8,        // below warnPassRate=0.95 → no signal
    discardRate: 0.05,    // above warnDiscardRate=0.01 → no signal
    adversarialCatchRate: null,
    firstTryPassRate: 0.75,
    scoreVolatility: 0.02, // above warnVolatility=0.005 → no signal
    stallFrequency: null,
    scores: [],
    partial: false,
    ...overrides,
  };
}

describe('detectTrustDrift()', () => {
  it('0 signals fire → isDrift: false', () => {
    const report = makeReport();
    const result = detectTrustDrift(report, DEFAULT_THRESHOLDS);

    expect(result.isDrift).toBe(false);
    expect(result.signals).toHaveLength(0);
  });

  it('1 signal fires (high pass rate only) → isDrift: false', () => {
    const report = makeReport({ passRate: 0.97 });
    const result = detectTrustDrift(report, DEFAULT_THRESHOLDS);

    expect(result.isDrift).toBe(false);
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]!.name).toBe('High pass rate');
  });

  it('2 signals fire (high pass rate + low discard) → isDrift: true', () => {
    const report = makeReport({ passRate: 0.97, discardRate: 0.005 });
    const result = detectTrustDrift(report, DEFAULT_THRESHOLDS);

    expect(result.isDrift).toBe(true);
    expect(result.signals).toHaveLength(2);
  });

  it('3 signals fire → isDrift: true', () => {
    const report = makeReport({ passRate: 0.97, discardRate: 0.005, scoreVolatility: 0.001 });
    const result = detectTrustDrift(report, DEFAULT_THRESHOLDS);

    expect(result.isDrift).toBe(true);
    expect(result.signals).toHaveLength(3);
  });

  it('4 signals fire → isDrift: true', () => {
    const report = makeReport({
      passRate: 0.97,
      discardRate: 0.005,
      scoreVolatility: 0.001,
      adversarialCatchRate: 0,
    });
    const result = detectTrustDrift(report, DEFAULT_THRESHOLDS);

    expect(result.isDrift).toBe(true);
    expect(result.signals).toHaveLength(4);
  });

  // All 6 pairwise 2-signal combinations
  it('pair: high pass rate + low volatility → isDrift: true', () => {
    const report = makeReport({ passRate: 0.97, scoreVolatility: 0.001 });
    const result = detectTrustDrift(report, DEFAULT_THRESHOLDS);

    expect(result.isDrift).toBe(true);
    expect(result.signals).toHaveLength(2);
  });

  it('pair: high pass rate + adversarial catch rate = 0 → isDrift: true', () => {
    const report = makeReport({ passRate: 0.97, adversarialCatchRate: 0 });
    const result = detectTrustDrift(report, DEFAULT_THRESHOLDS);

    expect(result.isDrift).toBe(true);
    expect(result.signals).toHaveLength(2);
  });

  it('pair: low discard rate + low volatility → isDrift: true', () => {
    const report = makeReport({ discardRate: 0.005, scoreVolatility: 0.001 });
    const result = detectTrustDrift(report, DEFAULT_THRESHOLDS);

    expect(result.isDrift).toBe(true);
    expect(result.signals).toHaveLength(2);
  });

  it('pair: low discard rate + adversarial catch rate = 0 → isDrift: true', () => {
    const report = makeReport({ discardRate: 0.005, adversarialCatchRate: 0 });
    const result = detectTrustDrift(report, DEFAULT_THRESHOLDS);

    expect(result.isDrift).toBe(true);
    expect(result.signals).toHaveLength(2);
  });

  it('pair: low volatility + adversarial catch rate = 0 → isDrift: true', () => {
    const report = makeReport({ scoreVolatility: 0.001, adversarialCatchRate: 0 });
    const result = detectTrustDrift(report, DEFAULT_THRESHOLDS);

    expect(result.isDrift).toBe(true);
    expect(result.signals).toHaveLength(2);
  });

  it('null adversarialCatchRate → adversarial signal excluded, not counted as fired', () => {
    // Only 1 real signal fires; adversarial is null → not drift
    const report = makeReport({ passRate: 0.97, adversarialCatchRate: null });
    const result = detectTrustDrift(report, DEFAULT_THRESHOLDS);

    expect(result.isDrift).toBe(false);
    expect(result.signals).toHaveLength(1);
  });

  it('null scoreVolatility → volatility signal excluded, not counted as fired', () => {
    // Only 1 real signal fires; volatility is null → not drift
    const report = makeReport({ passRate: 0.97, scoreVolatility: null });
    const result = detectTrustDrift(report, DEFAULT_THRESHOLDS);

    expect(result.isDrift).toBe(false);
    expect(result.signals).toHaveLength(1);
  });

  it('volatility at exact threshold — no signal (must be strictly less than)', () => {
    const report = makeReport({ scoreVolatility: 0.005 }); // equal, not less
    const result = detectTrustDrift(report, DEFAULT_THRESHOLDS);

    expect(result.signals.some(s => s.name === 'Low score volatility')).toBe(false);
  });

  it('pass rate at exact threshold — no signal (must be strictly greater than)', () => {
    const report = makeReport({ passRate: 0.95 }); // equal, not greater
    const result = detectTrustDrift(report, DEFAULT_THRESHOLDS);

    expect(result.signals.some(s => s.name === 'High pass rate')).toBe(false);
  });

  it('stall frequency is NOT a drift signal', () => {
    // High stall frequency should not contribute to drift
    const report = makeReport({
      passRate: 0.97, // 1 signal
      stallFrequency: 0.5, // stall — should not fire drift signal
    });
    const result = detectTrustDrift(report, DEFAULT_THRESHOLDS);

    expect(result.isDrift).toBe(false);
    expect(result.signals).toHaveLength(1);
  });
});

// ─── formatCalibrationReport ────────────────────────────────────────────────

function makeNoDriftResult(): TrustDriftResult {
  return { isDrift: false, signals: [] };
}

function makeDriftResult(): TrustDriftResult {
  return {
    isDrift: true,
    signals: [
      {
        name: 'High pass rate',
        value: '97%',
        threshold: '> 95%',
        interpretation: 'Validation may not be catching subtle issues',
      },
      {
        name: 'Low score volatility',
        value: '0.002',
        threshold: '< 0.005',
        interpretation: 'Scores are barely changing; work may have stagnated',
      },
    ],
  };
}

describe('formatCalibrationReport()', () => {
  it('normal state → includes "✓ Normal"', () => {
    const report = makeReport();
    const output = formatCalibrationReport(report, makeNoDriftResult());

    expect(output).toContain('✓ Normal');
    expect(output).toContain('All calibration metrics within expected ranges.');
  });

  it('drift state → includes "⚠ Drift" with signal count', () => {
    const report = makeReport();
    const output = formatCalibrationReport(report, makeDriftResult());

    expect(output).toContain('⚠ Drift (2 signals)');
    expect(output).toContain('High pass rate');
    expect(output).toContain('Low score volatility');
  });

  it('drift state → includes suggested actions', () => {
    const report = makeReport();
    const output = formatCalibrationReport(report, makeDriftResult());

    expect(output).toContain('Suggested actions');
    expect(output).toContain('ralph gc --json');
  });

  it('full window header — shows "last N iterations"', () => {
    const report = makeReport({ actual: 30, window: 30, partial: false });
    const output = formatCalibrationReport(report, makeNoDriftResult());

    expect(output).toContain('Calibration Report (last 30 iterations)');
  });

  it('partial window → includes "(partial window: N/W)"', () => {
    const report = makeReport({ actual: 12, window: 30, partial: true });
    const output = formatCalibrationReport(report, makeNoDriftResult());

    expect(output).toContain('12 of 30 iterations — partial window');
  });

  it('adversarial data present → adversarial catch rate line included', () => {
    const report = makeReport({ adversarialCatchRate: 0.4 });
    const output = formatCalibrationReport(report, makeNoDriftResult());

    expect(output).toContain('Adversarial catch rate');
  });

  it('adversarial data absent (null) → no adversarial line', () => {
    const report = makeReport({ adversarialCatchRate: null });
    const output = formatCalibrationReport(report, makeNoDriftResult());

    expect(output).not.toContain('Adversarial catch rate');
  });

  it('stall data absent (null) → "unavailable" label', () => {
    const report = makeReport({ stallFrequency: null });
    const output = formatCalibrationReport(report, makeNoDriftResult());

    expect(output).toContain('unavailable (no stall entries recorded)');
  });

  it('stall data present → shows stall frequency percentage', () => {
    const report = makeReport({ stallFrequency: 0.1 });
    const output = formatCalibrationReport(report, makeNoDriftResult());

    expect(output).toContain('Stall frequency');
    expect(output).not.toContain('unavailable (no stall entries recorded)');
  });

  it('score volatility absent (null) → "unavailable" label for volatility', () => {
    const report = makeReport({ scoreVolatility: null });
    const output = formatCalibrationReport(report, makeNoDriftResult());

    expect(output).toContain('unavailable (insufficient scored entries)');
  });

  it('contains pass rate and discard rate lines', () => {
    const report = makeReport({ passRate: 0.8, discardRate: 0.05, actual: 30 });
    const output = formatCalibrationReport(report, makeNoDriftResult());

    expect(output).toContain('Pass rate:');
    expect(output).toContain('Discard rate:');
    expect(output).toContain('First-try pass rate:');
  });
});

// ─── formatCalibrationJSON ──────────────────────────────────────────────────

describe('formatCalibrationJSON()', () => {
  it('output is valid JSON (JSON.parse succeeds)', () => {
    const report = makeReport();
    const result = formatCalibrationJSON(report, makeNoDriftResult());

    expect(() => JSON.parse(JSON.stringify(result))).not.toThrow();
  });

  it('all numeric fields are numbers (not strings)', () => {
    const report = makeReport({ passRate: 0.8, discardRate: 0.05, scoreVolatility: 0.01 });
    const result = formatCalibrationJSON(report, makeNoDriftResult()) as Record<string, unknown>;
    const cal = result['calibration'] as Record<string, unknown>;

    expect(typeof cal['passRate']).toBe('number');
    expect(typeof cal['discardRate']).toBe('number');
    expect(typeof cal['scoreVolatility']).toBe('number');
    expect(typeof cal['window']).toBe('number');
    expect(typeof cal['actual']).toBe('number');
  });

  it('null fields are JSON null (not omitted or empty string)', () => {
    const report = makeReport({ adversarialCatchRate: null, stallFrequency: null, scoreVolatility: null });
    const result = formatCalibrationJSON(report, makeNoDriftResult()) as Record<string, unknown>;
    const cal = result['calibration'] as Record<string, unknown>;

    expect(cal['adversarialCatchRate']).toBeNull();
    expect(cal['stallFrequency']).toBeNull();
    expect(cal['scoreVolatility']).toBeNull();
  });

  it('includes calibration, trustDrift, and timestamp fields', () => {
    const report = makeReport();
    const result = formatCalibrationJSON(report, makeNoDriftResult()) as Record<string, unknown>;

    expect(result).toHaveProperty('calibration');
    expect(result).toHaveProperty('trustDrift');
    expect(result).toHaveProperty('timestamp');
  });

  it('timestamp is a valid ISO 8601 date string', () => {
    const report = makeReport();
    const result = formatCalibrationJSON(report, makeNoDriftResult()) as Record<string, unknown>;

    expect(typeof result['timestamp']).toBe('string');
    expect(new Date(result['timestamp'] as string).toISOString()).toBe(result['timestamp']);
  });

  it('partial field included in calibration object', () => {
    const report = makeReport({ partial: true, actual: 12, window: 30 });
    const result = formatCalibrationJSON(report, makeNoDriftResult()) as Record<string, unknown>;
    const cal = result['calibration'] as Record<string, unknown>;

    expect(cal['partial']).toBe(true);
  });

  it('drift result included in trustDrift field', () => {
    const report = makeReport();
    const drift = makeDriftResult();
    const result = formatCalibrationJSON(report, drift) as Record<string, unknown>;
    const trustDrift = result['trustDrift'] as Record<string, unknown>;

    expect(trustDrift['isDrift']).toBe(true);
    expect(Array.isArray(trustDrift['signals'])).toBe(true);
    expect((trustDrift['signals'] as unknown[]).length).toBe(2);
  });

  it('insufficient data (< 5 entries) → error object', () => {
    const report: CalibrationReport = {
      window: 30,
      actual: 3,
      passRate: 0,
      discardRate: 0,
      adversarialCatchRate: null,
      firstTryPassRate: 0,
      scoreVolatility: null,
      stallFrequency: null,
      scores: [],
      partial: true,
    };
    const result = formatCalibrationJSON(report, makeNoDriftResult()) as Record<string, unknown>;

    expect(result['calibration']).toBeNull();
    expect(result['error']).toBe('insufficient data');
    expect(result['entries']).toBe(3);
    expect(result['minimum']).toBe(5);
  });
});
