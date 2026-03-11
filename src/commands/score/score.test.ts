import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';

// ─── scorer.ts ───────────────────────────────────────────────────────────────

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';
const mockSpawn = vi.mocked(spawn);

import { discoverScorer, runScorer } from './scorer.js';
import { runDefaultScorer } from './default-scorer.js';
import { appendResult, readResults } from './results.js';
import { renderSparkline, computeTrend } from './trend.js';
import type { ResultEntry } from './types.js';
import type { RalphConfig } from '../../config/schema.js';

function makeProc(hasStdout = true) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter | null;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = hasStdout ? new EventEmitter() : null;
  proc.kill = vi.fn();
  return proc;
}

function makeDefaultConfig(overrides: Partial<RalphConfig> = {}): RalphConfig {
  return {
    project: { name: 'test', path: '.' },
    architecture: { layers: [], domains: [], rules: [] },
    quality: {
      coverage: { 'report-path': 'coverage/coverage-summary.json', minimum: 0 },
      'min-grade': 'C',
      'per-domain': {},
    },
    run: {
      agent: { cli: 'claude', args: ['--print'], timeout: 1800 },
      'plan-agent': null,
      'build-agent': null,
      prompts: { plan: null, build: null },
      loop: { 'max-iterations': 0, 'stall-threshold': 3, 'iteration-timeout': 900 },
      validation: { 'test-command': null, 'typecheck-command': null },
      git: { 'auto-commit': true, 'auto-push': false, 'commit-prefix': 'ralph:', branch: null },
    },
    review: {
      agent: null,
      scope: 'staged',
      context: { 'include-specs': true, 'include-architecture': true, 'include-diff-context': 5, 'max-diff-lines': 2000 },
      output: { format: 'text', file: null, 'severity-threshold': 'info' },
    },
    heal: {
      agent: null,
      commands: ['doctor', 'grade', 'gc', 'lint'],
      'auto-commit': true,
      'commit-prefix': 'ralph: heal',
    },
    gc: { exclude: [], 'max-age-days': 90 },
    promote: { 'min-violations': 3, 'escalation-path': [] },
    doctor: { 'check-interval-days': 7 },
    ...overrides,
  } as unknown as RalphConfig;
}

// ─── discoverScorer ───────────────────────────────────────────────────────────

describe('discoverScorer', () => {
  let tmpDir: string;
  let origCwd: string;

  beforeEach(() => {
    origCwd = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), 'ralph-score-test-'));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when no script files present and no config override', () => {
    expect(discoverScorer(undefined)).toBeNull();
  });

  it('returns score.sh when present', () => {
    writeFileSync(join(tmpDir, 'score.sh'), '#!/bin/sh\necho 0.8');
    expect(discoverScorer(undefined)).toBe('score.sh');
  });

  it('returns score.ts when present (score.sh absent)', () => {
    writeFileSync(join(tmpDir, 'score.ts'), 'console.log("0.8")');
    expect(discoverScorer(undefined)).toBe('score.ts');
  });

  it('returns score.py when present (score.sh and score.ts absent)', () => {
    writeFileSync(join(tmpDir, 'score.py'), 'print("0.8")');
    expect(discoverScorer(undefined)).toBe('score.py');
  });

  it('score.sh takes priority over score.ts', () => {
    writeFileSync(join(tmpDir, 'score.sh'), '#!/bin/sh\necho 0.8');
    writeFileSync(join(tmpDir, 'score.ts'), 'console.log("0.8")');
    expect(discoverScorer(undefined)).toBe('score.sh');
  });

  it('config.script overrides all other paths', () => {
    const scriptPath = join(tmpDir, 'custom-score.sh');
    writeFileSync(scriptPath, '#!/bin/sh\necho 0.9');
    writeFileSync(join(tmpDir, 'score.sh'), '#!/bin/sh\necho 0.8');
    expect(discoverScorer({ script: scriptPath, 'regression-threshold': 0.02, 'cumulative-threshold': 0.1, 'auto-revert': true, 'default-weights': { tests: 0.6, coverage: 0.4 } })).toBe(scriptPath);
  });

  it('throws when config.script is set but file is missing', () => {
    expect(() => discoverScorer({ script: '/nonexistent/score.sh', 'regression-threshold': 0.02, 'cumulative-threshold': 0.1, 'auto-revert': true, 'default-weights': { tests: 0.6, coverage: 0.4 } })).toThrow('Scoring script not found');
  });
});

// ─── runScorer ────────────────────────────────────────────────────────────────

describe('runScorer', () => {
  beforeEach(() => {
    mockSpawn.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('parses score and metrics from stdout', async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const promise = runScorer('score.sh', 1, 'abc1234');
    proc.stdout!.emit('data', Buffer.from('0.85\ttest_rate=0.95 coverage=0.75\n'));
    proc.emit('close', 0);

    const result = await promise;
    expect(result.score).toBe(0.85);
    expect(result.source).toBe('script');
    expect(result.scriptPath).toBe('score.sh');
    expect(result.metrics['test_rate']).toBe('0.95');
    expect(result.metrics['coverage']).toBe('0.75');
  });

  it('parses score when no tab (no metrics)', async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const promise = runScorer('score.sh', 1, 'abc1234');
    proc.stdout!.emit('data', Buffer.from('0.72\n'));
    proc.emit('close', 0);

    const result = await promise;
    expect(result.score).toBe(0.72);
    expect(result.metrics).toEqual({});
  });

  it('returns null score for empty output', async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const promise = runScorer('score.sh', 1, 'abc1234');
    proc.stdout!.emit('data', Buffer.from('\n'));
    proc.emit('close', 0);

    const result = await promise;
    expect(result.score).toBeNull();
    expect(result.error).toBe('empty output');
  });

  it('returns null score for out-of-range score (> 1.0)', async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const promise = runScorer('score.sh', 1, 'abc1234');
    proc.stdout!.emit('data', Buffer.from('1.5\n'));
    proc.emit('close', 0);

    const result = await promise;
    expect(result.score).toBeNull();
    expect(result.error).toMatch(/out of range/);
  });

  it('returns null score for out-of-range score (< 0.0)', async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const promise = runScorer('score.sh', 1, 'abc1234');
    proc.stdout!.emit('data', Buffer.from('-0.1\n'));
    proc.emit('close', 0);

    const result = await promise;
    expect(result.score).toBeNull();
    expect(result.error).toMatch(/out of range/);
  });

  it('returns null score for non-numeric score', async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const promise = runScorer('score.sh', 1, 'abc1234');
    proc.stdout!.emit('data', Buffer.from('not-a-number\n'));
    proc.emit('close', 0);

    const result = await promise;
    expect(result.score).toBeNull();
    expect(result.error).toMatch(/invalid score/);
  });

  it('returns null score on non-zero exit code', async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const promise = runScorer('score.sh', 1, 'abc1234');
    proc.emit('close', 1);

    const result = await promise;
    expect(result.score).toBeNull();
    expect(result.error).toMatch(/exit 1/);
  });

  it('returns EACCES fallback (source=default) on error event with EACCES', async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const promise = runScorer('score.sh', 1, 'abc1234');
    const err = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    proc.emit('error', err);

    const result = await promise;
    expect(result.score).toBeNull();
    expect(result.source).toBe('default');
    expect(result.scriptPath).toBeNull();
    expect(result.error).toBe('EACCES');
  });

  it('kills process after 60s timeout', async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const promise = runScorer('score.sh', 1, 'abc1234');
    vi.advanceTimersByTime(60_001);

    const result = await promise;
    expect(result.score).toBeNull();
    expect(result.error).toBe('timeout');
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('passes RALPH_ITERATION and RALPH_COMMIT env vars', async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const promise = runScorer('score.sh', 5, 'deadbeef');
    proc.stdout!.emit('data', Buffer.from('0.5\n'));
    proc.emit('close', 0);
    await promise;

    const spawnCall = mockSpawn.mock.calls[0];
    expect(spawnCall?.[2]).toMatchObject({
      env: expect.objectContaining({
        RALPH_ITERATION: '5',
        RALPH_COMMIT: 'deadbeef',
      }),
    });
  });

  it('uses npx tsx for .ts scripts', async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const promise = runScorer('score.ts', 1, 'abc');
    proc.stdout!.emit('data', Buffer.from('0.7\n'));
    proc.emit('close', 0);
    await promise;

    const [cli, args] = mockSpawn.mock.calls[0]!;
    expect(cli).toBe('npx');
    expect(args).toContain('tsx');
    expect(args).toContain('score.ts');
  });

  it('uses python3 for .py scripts', async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const promise = runScorer('score.py', 1, 'abc');
    proc.stdout!.emit('data', Buffer.from('0.7\n'));
    proc.emit('close', 0);
    await promise;

    const [cli, args] = mockSpawn.mock.calls[0]!;
    expect(cli).toBe('python3');
    expect(args).toContain('score.py');
  });
});

// ─── runDefaultScorer ─────────────────────────────────────────────────────────

describe('runDefaultScorer', () => {
  let tmpDir: string;
  let origCwd: string;

  beforeEach(() => {
    origCwd = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), 'ralph-default-scorer-'));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parses "N passed" test pattern', () => {
    const config = makeDefaultConfig();
    const result = runDefaultScorer('100 passed (5.2s)', config);
    expect(result.score).toBe(1.0); // 100/100, no coverage
    expect(result.metrics['test_count']).toBe('100');
    expect(result.metrics['test_total']).toBe('100');
    expect(result.metrics['test_rate']).toBe('1.0000');
  });

  it('parses "Tests: N passed" vitest pattern', () => {
    const config = makeDefaultConfig();
    const result = runDefaultScorer('Tests: 85 passed (90)', config);
    expect(result.metrics['test_count']).toBe('85');
  });

  it('parses "N passing" mocha pattern', () => {
    const config = makeDefaultConfig();
    const result = runDefaultScorer('50 passing (3s)', config);
    expect(result.metrics['test_count']).toBe('50');
  });

  it('parses "N tests passed" pattern', () => {
    const config = makeDefaultConfig();
    const result = runDefaultScorer('42 tests passed', config);
    expect(result.metrics['test_count']).toBe('42');
  });

  it('parses "passed: N" pattern (case-insensitive)', () => {
    const config = makeDefaultConfig();
    const result = runDefaultScorer('Passed: 77', config);
    expect(result.metrics['test_count']).toBe('77');
  });

  it('includes failed tests in total', () => {
    const config = makeDefaultConfig();
    const result = runDefaultScorer('80 passed\n5 failed', config);
    expect(result.metrics['test_count']).toBe('80');
    expect(result.metrics['test_total']).toBe('85');
    const rate = parseFloat(result.metrics['test_rate']!);
    expect(rate).toBeCloseTo(80 / 85, 4);
  });

  it('reads coverage from total.statements.pct (highest priority)', () => {
    const coverageData = {
      total: { statements: { pct: 87.5 }, lines: { pct: 90.0 } },
    };
    const coveragePath = join(tmpDir, 'coverage.json');
    writeFileSync(coveragePath, JSON.stringify(coverageData));
    const config = makeDefaultConfig();
    (config.quality.coverage as unknown as { 'report-path': string })['report-path'] = coveragePath;
    const result = runDefaultScorer('100 passed', config);
    expect(result.metrics['coverage']).toBe((87.5 / 100).toFixed(4));
  });

  it('reads coverage from total.lines.pct (second priority)', () => {
    const coverageData = {
      total: { lines: { pct: 72.0 } },
    };
    const coveragePath = join(tmpDir, 'coverage.json');
    writeFileSync(coveragePath, JSON.stringify(coverageData));
    const config = makeDefaultConfig();
    (config.quality.coverage as unknown as { 'report-path': string })['report-path'] = coveragePath;
    const result = runDefaultScorer('', config);
    const coverageRate = parseFloat(result.metrics['coverage']!);
    expect(coverageRate).toBeCloseTo(0.72, 4);
  });

  it('reads coverage from statements.pct (third priority)', () => {
    const coverageData = { statements: { pct: 65.0 } };
    const coveragePath = join(tmpDir, 'coverage.json');
    writeFileSync(coveragePath, JSON.stringify(coverageData));
    const config = makeDefaultConfig();
    (config.quality.coverage as unknown as { 'report-path': string })['report-path'] = coveragePath;
    const result = runDefaultScorer('', config);
    const coverageRate = parseFloat(result.metrics['coverage']!);
    expect(coverageRate).toBeCloseTo(0.65, 4);
  });

  it('reads coverage from lines.pct (fourth priority)', () => {
    const coverageData = { lines: { pct: 55.0 } };
    const coveragePath = join(tmpDir, 'coverage.json');
    writeFileSync(coveragePath, JSON.stringify(coverageData));
    const config = makeDefaultConfig();
    (config.quality.coverage as unknown as { 'report-path': string })['report-path'] = coveragePath;
    const result = runDefaultScorer('', config);
    const coverageRate = parseFloat(result.metrics['coverage']!);
    expect(coverageRate).toBeCloseTo(0.55, 4);
  });

  it('computes weighted score with both signals (default weights)', () => {
    const coverageData = { total: { statements: { pct: 80.0 } } };
    const coveragePath = join(tmpDir, 'coverage.json');
    writeFileSync(coveragePath, JSON.stringify(coverageData));
    const config = makeDefaultConfig();
    (config.quality.coverage as unknown as { 'report-path': string })['report-path'] = coveragePath;
    // 100 passed, no failed → test_rate=1.0, coverage=0.8
    // score = 1.0 * 0.6 + 0.8 * 0.4 = 0.92
    const result = runDefaultScorer('100 passed', config);
    expect(result.score).toBeCloseTo(0.92, 4);
  });

  it('uses test rate alone when coverage not available', () => {
    const config = makeDefaultConfig();
    const result = runDefaultScorer('90 passed\n10 failed', config);
    expect(result.score).toBeCloseTo(0.9, 4);
  });

  it('uses coverage alone when test count not found', () => {
    const coverageData = { total: { statements: { pct: 75.0 } } };
    const coveragePath = join(tmpDir, 'coverage.json');
    writeFileSync(coveragePath, JSON.stringify(coverageData));
    const config = makeDefaultConfig();
    (config.quality.coverage as unknown as { 'report-path': string })['report-path'] = coveragePath;
    const result = runDefaultScorer('no test output here', config);
    expect(result.score).toBeCloseTo(0.75, 4);
  });

  it('returns null score when neither signal is available', () => {
    const config = makeDefaultConfig();
    const result = runDefaultScorer('no test output here', config);
    expect(result.score).toBeNull();
    expect(result.source).toBe('default');
    expect(result.scriptPath).toBeNull();
  });

  it('always includes test_count, test_total in metrics', () => {
    const config = makeDefaultConfig();
    const result = runDefaultScorer('', config);
    expect(result.metrics).toHaveProperty('test_count');
    expect(result.metrics).toHaveProperty('test_total');
    expect(result.metrics).toHaveProperty('test_rate');
    expect(result.metrics).toHaveProperty('coverage');
  });

  it('respects custom weights from config', () => {
    const coverageData = { total: { statements: { pct: 100.0 } } };
    const coveragePath = join(tmpDir, 'coverage.json');
    writeFileSync(coveragePath, JSON.stringify(coverageData));
    const config = makeDefaultConfig({
      scoring: {
        script: null,
        'regression-threshold': 0.02,
        'cumulative-threshold': 0.1,
        'auto-revert': true,
        'default-weights': { tests: 0.3, coverage: 0.7 },
      },
    } as Partial<RalphConfig>);
    (config.quality.coverage as unknown as { 'report-path': string })['report-path'] = coveragePath;
    // score = 1.0 * 0.3 + 1.0 * 0.7 = 1.0
    const result = runDefaultScorer('100 passed', config);
    expect(result.score).toBeCloseTo(1.0, 4);
  });
});

// ─── results.ts ───────────────────────────────────────────────────────────────

describe('results.ts', () => {
  let tmpDir: string;
  let origCwd: string;

  beforeEach(() => {
    origCwd = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), 'ralph-results-test-'));
    mkdirSync(join(tmpDir, '.ralph'), { recursive: true });
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeEntry(overrides: Partial<ResultEntry> = {}): ResultEntry {
    return {
      commit: 'abc1234',
      iteration: 1,
      status: 'pass',
      score: 0.85,
      delta: 0.05,
      durationS: 42,
      metrics: 'test_rate=0.95 coverage=0.75',
      description: 'ralph: build task 1',
      ...overrides,
    };
  }

  it('creates header on first append', () => {
    appendResult(makeEntry());
    const results = readResults();
    expect(results).toHaveLength(1);
  });

  it('round-trips a full entry', () => {
    const entry = makeEntry();
    appendResult(entry);
    const [r] = readResults();
    expect(r!.commit).toBe('abc1234');
    expect(r!.iteration).toBe(1);
    expect(r!.status).toBe('pass');
    expect(r!.score).toBeCloseTo(0.85, 4);
    expect(r!.delta).toBeCloseTo(0.05, 4);
    expect(r!.durationS).toBe(42);
    expect(r!.metrics).toBe('test_rate=0.95 coverage=0.75');
    expect(r!.description).toBe('ralph: build task 1');
  });

  it('appends multiple entries', () => {
    appendResult(makeEntry({ iteration: 1 }));
    appendResult(makeEntry({ iteration: 2 }));
    appendResult(makeEntry({ iteration: 3 }));
    const results = readResults();
    expect(results).toHaveLength(3);
    expect(results[2]!.iteration).toBe(3);
  });

  it('renders null score as —', () => {
    appendResult(makeEntry({ score: null, delta: null }));
    const [r] = readResults();
    expect(r!.score).toBeNull();
    expect(r!.delta).toBeNull();
  });

  it('sanitizes tab characters in values', () => {
    appendResult(makeEntry({ description: 'fix\ttabs\there' }));
    const [r] = readResults();
    expect(r!.description).toBe('fix tabs here');
  });

  it('sanitizes control characters in metrics', () => {
    appendResult(makeEntry({ metrics: 'a=1\x01b=2' }));
    const [r] = readResults();
    // Control chars replaced with spaces
    expect(r!.metrics).toMatch(/a=1.b=2/);
  });

  it('caps metrics at 200 chars with ellipsis', () => {
    const longMetrics = 'x='.padEnd(201, 'a');
    appendResult(makeEntry({ metrics: longMetrics }));
    const [r] = readResults();
    expect(r!.metrics.length).toBeLessThanOrEqual(201); // 200 chars + '…' (1 char)
    expect(r!.metrics.endsWith('…')).toBe(true);
  });

  it('respects limit parameter', () => {
    for (let i = 1; i <= 5; i++) {
      appendResult(makeEntry({ iteration: i }));
    }
    const results = readResults(3);
    expect(results).toHaveLength(3);
    expect(results[0]!.iteration).toBe(3);
    expect(results[2]!.iteration).toBe(5);
  });

  it('returns empty array when file does not exist', () => {
    const results = readResults();
    expect(results).toEqual([]);
  });

  it('creates .ralph dir if missing when appending', () => {
    rmSync(join(tmpDir, '.ralph'), { recursive: true, force: true });
    appendResult(makeEntry());
    const results = readResults();
    expect(results).toHaveLength(1);
  });
});

// ─── trend.ts ─────────────────────────────────────────────────────────────────

describe('renderSparkline', () => {
  it('returns empty string for empty input', () => {
    expect(renderSparkline([])).toBe('');
  });

  it('returns empty string for all-null input', () => {
    expect(renderSparkline([null, null, null])).toBe('');
  });

  it('uses flat char when all scores equal', () => {
    const result = renderSparkline([0.5, 0.5, 0.5]);
    expect(result).toBe('▅▅▅');
  });

  it('renders increasing sequence with ascending bars', () => {
    const result = renderSparkline([0.0, 0.5, 1.0]);
    const chars = [...result];
    // Each character should be >= the previous
    for (let i = 1; i < chars.length; i++) {
      expect(chars[i]! >= chars[i - 1]!).toBe(true);
    }
  });

  it('uses correct Unicode block chars', () => {
    const SPARKLINE_CHARS = '▁▂▃▄▅▆▇█';
    const result = renderSparkline([0.0, 1.0]);
    for (const ch of result) {
      expect(SPARKLINE_CHARS).toContain(ch);
    }
  });

  it('skips null entries (does not render them)', () => {
    const result = renderSparkline([0.5, null, 0.8]);
    expect([...result]).toHaveLength(2);
  });

  it('renders minimum score as ▁ and maximum as █', () => {
    const result = renderSparkline([0.0, 1.0]);
    const chars = [...result];
    expect(chars[0]).toBe('▁');
    expect(chars[1]).toBe('█');
  });
});

describe('computeTrend', () => {
  function makeEntry(iteration: number, score: number | null): ResultEntry {
    return {
      commit: 'abc',
      iteration,
      status: 'pass',
      score,
      delta: null,
      durationS: 1,
      metrics: '—',
      description: '—',
    };
  }

  it('returns null for empty entries', () => {
    expect(computeTrend([], 20)).toBeNull();
  });

  it('returns null when all entries have null scores', () => {
    const entries = [makeEntry(1, null), makeEntry(2, null)];
    expect(computeTrend(entries, 20)).toBeNull();
  });

  it('computes min, max, first, last correctly', () => {
    const entries = [
      makeEntry(1, 0.5),
      makeEntry(2, 0.8),
      makeEntry(3, 0.3),
      makeEntry(4, 0.7),
    ];
    const trend = computeTrend(entries, 20)!;
    expect(trend.min).toBeCloseTo(0.3);
    expect(trend.max).toBeCloseTo(0.8);
    expect(trend.first).toBeCloseTo(0.5);
    expect(trend.last).toBeCloseTo(0.7);
  });

  it('identifies best and worst iterations', () => {
    const entries = [
      makeEntry(1, 0.5),
      makeEntry(2, 0.9),
      makeEntry(3, 0.2),
    ];
    const trend = computeTrend(entries, 20)!;
    expect(trend.bestIteration).toBe(2);
    expect(trend.worstIteration).toBe(3);
  });

  it('respects the window (n parameter)', () => {
    const entries = [
      makeEntry(1, 0.1),
      makeEntry(2, 0.9),
      makeEntry(3, 0.5),
    ];
    const trend = computeTrend(entries, 2)!;
    // Only last 2 entries (iterations 2 and 3)
    expect(trend.first).toBeCloseTo(0.9);
    expect(trend.last).toBeCloseTo(0.5);
    expect(trend.max).toBeCloseTo(0.9);
    expect(trend.min).toBeCloseTo(0.5);
  });

  it('skips null scores in trend computation', () => {
    const entries = [
      makeEntry(1, 0.5),
      makeEntry(2, null),
      makeEntry(3, 0.8),
    ];
    const trend = computeTrend(entries, 20)!;
    expect(trend.min).toBeCloseTo(0.5);
    expect(trend.max).toBeCloseTo(0.8);
    expect(trend.first).toBeCloseTo(0.5);
    expect(trend.last).toBeCloseTo(0.8);
  });
});
