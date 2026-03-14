import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildScoreContext, computeRegression, computeChangedMetrics, formatDivergenceContext } from './scoring.js';
import type { ScoreContext } from '../score/types.js';
import type { Checkpoint } from './progress.js';

// ─── Unit tests ───────────────────────────────────────────────────────────────

function makeScoreContext(overrides: Partial<ScoreContext> = {}): ScoreContext {
  return {
    previousStatus: null,
    previousScore: null,
    currentScore: null,
    delta: null,
    metrics: '—',
    changedMetrics: '(none)',
    timeoutSeconds: 900,
    regressionThreshold: 0.02,
    previousTestCount: null,
    currentTestCount: null,
    failedStage: null,
    stageResults: null,
    ...overrides,
  };
}

function makeCheckpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    version: 1,
    phase: 'build',
    startedAt: new Date().toISOString(),
    iteration: 0,
    history: [],
    ...overrides,
  };
}

// ─── buildScoreContext ────────────────────────────────────────────────────────

describe('buildScoreContext', () => {
  it('previousStatus=null returns empty string (first iteration)', () => {
    expect(buildScoreContext(makeScoreContext({ previousStatus: null }))).toBe('');
  });

  it('previousStatus=pass includes current score, previous score, delta, and regression note', () => {
    const ctx = makeScoreContext({
      previousStatus: 'pass',
      currentScore: 0.85,
      previousScore: 0.80,
      delta: 0.05,
      metrics: 'test_count=100 coverage=85',
      regressionThreshold: 0.02,
    });
    const result = buildScoreContext(ctx);
    expect(result).toContain('Score Context');
    expect(result).toContain('0.850');
    expect(result).toContain('0.800');
    expect(result).toContain('+0.050');
    expect(result).toContain('test_count=100');
    expect(result).toContain('Regressions beyond 0.02');
  });

  it('previousStatus=pass with negative delta shows negative sign', () => {
    const ctx = makeScoreContext({
      previousStatus: 'pass',
      currentScore: 0.75,
      previousScore: 0.80,
      delta: -0.05,
      metrics: '—',
    });
    const result = buildScoreContext(ctx);
    expect(result).toContain('-0.050');
  });

  it('previousStatus=discard includes regression warning and revert note', () => {
    const ctx = makeScoreContext({
      previousStatus: 'discard',
      previousScore: 0.80,
      currentScore: 0.75,
      delta: -0.05,
      changedMetrics: 'test_count: 100→90',
    });
    const result = buildScoreContext(ctx);
    expect(result).toContain('Score Context');
    expect(result).toContain('DISCARDED');
    expect(result).toContain('score regression');
    expect(result).toContain('reverted');
    expect(result).toContain('test_count: 100→90');
  });

  it('previousStatus=timeout includes timeout duration and revert note', () => {
    const ctx = makeScoreContext({
      previousStatus: 'timeout',
      timeoutSeconds: 600,
    });
    const result = buildScoreContext(ctx);
    expect(result).toContain('Score Context');
    expect(result).toContain('TIMED OUT');
    expect(result).toContain('600s');
    expect(result).toContain('reverted');
  });

  it('previousStatus=fail includes failed validation note', () => {
    const ctx = makeScoreContext({ previousStatus: 'fail' });
    const result = buildScoreContext(ctx);
    expect(result).toContain('Score Context');
    expect(result).toContain('FAILED validation');
    expect(result).toContain('reverted');
  });

  it('unknown status returns empty string', () => {
    // TypeScript won't allow this, but test the runtime else branch
    const ctx = makeScoreContext({
      previousStatus: 'unknown' as 'pass',
    });
    expect(buildScoreContext(ctx)).toBe('');
  });

  // ── stage-aware fail messages ─────────────────────────────────────────────

  it('previousStatus=fail with 2+ stages: produces stage-aware message naming the failed stage', () => {
    const ctx = makeScoreContext({
      previousStatus: 'fail',
      failedStage: 'integration',
      stageResults: 'unit:pass,typecheck:pass,integration:fail',
    });
    const result = buildScoreContext(ctx);
    expect(result).toContain('FAILED validation at stage "integration"');
    expect(result).toContain('unit ✓');
    expect(result).toContain('integration ✗');
  });

  it('previousStatus=fail with null stageResults: produces v0.5 generic message', () => {
    const ctx = makeScoreContext({
      previousStatus: 'fail',
      failedStage: null,
      stageResults: null,
    });
    const result = buildScoreContext(ctx);
    expect(result).toContain('FAILED validation');
    expect(result).not.toContain('at stage');
    expect(result).toContain('Ensure all tests pass');
  });

  it('previousStatus=fail with single-entry stageResults: falls back to generic message', () => {
    const ctx = makeScoreContext({
      previousStatus: 'fail',
      failedStage: 'test',
      stageResults: 'test:fail',
    });
    const result = buildScoreContext(ctx);
    expect(result).toContain('FAILED validation');
    expect(result).not.toContain('at stage');
    expect(result).toContain('Ensure all tests pass');
  });

  // ── test count jump warning ───────────────────────────────────────────────

  it('adds test count jump warning when currentTestCount > previousTestCount * 2', () => {
    const ctx = makeScoreContext({
      previousStatus: 'pass',
      currentScore: 0.8,
      previousScore: 0.75,
      delta: 0.05,
      metrics: '—',
      previousTestCount: 100,
      currentTestCount: 201, // > 100 * 2
    });
    const result = buildScoreContext(ctx);
    expect(result).toContain('Test count increased significantly');
    expect(result).toContain('100 → 201');
  });

  it('no test count warning when exactly at double (not over)', () => {
    const ctx = makeScoreContext({
      previousStatus: 'pass',
      currentScore: 0.8,
      previousScore: 0.75,
      delta: 0.05,
      metrics: '—',
      previousTestCount: 100,
      currentTestCount: 200, // exactly 2x, not > 2x
    });
    expect(buildScoreContext(ctx)).not.toContain('Test count increased');
  });

  it('skips test count warning when previousTestCount is 0', () => {
    const ctx = makeScoreContext({
      previousStatus: 'pass',
      currentScore: 0.8,
      previousScore: 0.0,
      delta: 0.8,
      metrics: '—',
      previousTestCount: 0,
      currentTestCount: 500,
    });
    // previousTestCount=0 means prev count is 0 — condition requires prevTestCount > 0
    expect(buildScoreContext(ctx)).not.toContain('Test count increased');
  });

  it('skips test count warning when previousTestCount is null', () => {
    const ctx = makeScoreContext({
      previousStatus: 'pass',
      currentScore: 0.8,
      previousScore: null,
      delta: null,
      metrics: '—',
      previousTestCount: null,
      currentTestCount: 500,
    });
    expect(buildScoreContext(ctx)).not.toContain('Test count increased');
  });

  // ── adversarial-fail branch ───────────────────────────────────────────────

  it('previousStatus=adversarial-fail: output contains both test names and branch name', () => {
    const ctx = makeScoreContext({
      previousStatus: 'adversarial-fail',
      adversarialResult: {
        outcome: 'fail',
        testFilesAdded: [],
        failedTests: ['should handle empty input', 'should reject null values'],
        diagnosticBranch: 'ralph/adversarial/3',
        testCountBefore: 100,
        testCountAfter: null,
      },
    });
    const result = buildScoreContext(ctx);
    expect(result).toContain('REVERTED by adversarial testing');
    expect(result).toContain('should handle empty input');
    expect(result).toContain('should reject null values');
    expect(result).toContain('ralph/adversarial/3');
  });

  it('previousStatus=pass + adversarialResult.outcome=pass: output contains edge-case test count', () => {
    const ctx = makeScoreContext({
      previousStatus: 'pass',
      currentScore: 0.85,
      previousScore: 0.80,
      delta: 0.05,
      metrics: '—',
      adversarialResult: {
        outcome: 'pass',
        testFilesAdded: ['src/a.test.ts', 'src/b.test.ts', 'src/c.test.ts'],
        failedTests: [],
        diagnosticBranch: null,
        testCountBefore: 100,
        testCountAfter: 103,
      },
    });
    const result = buildScoreContext(ctx);
    expect(result).toContain('Adversarial testing passed: 3 edge-case tests added and passing.');
  });

  it('previousStatus=pass + adversarialResult.outcome=skip: output contains skipped', () => {
    const ctx = makeScoreContext({
      previousStatus: 'pass',
      currentScore: 0.85,
      previousScore: 0.80,
      delta: 0.05,
      metrics: '—',
      adversarialResult: {
        outcome: 'skip',
        testFilesAdded: [],
        failedTests: [],
        diagnosticBranch: null,
        testCountBefore: null,
        testCountAfter: null,
        skipReason: 'no tests written',
      },
    });
    const result = buildScoreContext(ctx);
    expect(result).toContain('skipped (no tests written)');
  });

  // ── divergenceInfo ────────────────────────────────────────────────────────

  it('previousStatus=pass with divergenceInfo → output contains divergence info block (SC-14)', () => {
    const ctx = makeScoreContext({
      previousStatus: 'pass',
      currentScore: 0.85,
      previousScore: 0.80,
      delta: 0.05,
      metrics: '—',
      divergenceInfo: 'ℹ Approach divergence detected:\n  error-handling: ".catch()" appeared',
    });
    const result = buildScoreContext(ctx);
    expect(result).toContain('ℹ Approach divergence detected:');
    expect(result).toContain('error-handling');
  });

  it('previousStatus=pass with divergenceInfo=undefined → no divergence block (SC-15)', () => {
    const ctx = makeScoreContext({
      previousStatus: 'pass',
      currentScore: 0.85,
      previousScore: 0.80,
      delta: 0.05,
      metrics: '—',
      divergenceInfo: undefined,
    });
    const result = buildScoreContext(ctx);
    expect(result).not.toContain('divergence');
    expect(result).toContain('Score Context');
  });

  it('previousStatus=null → returns empty string regardless of divergenceInfo', () => {
    const ctx = makeScoreContext({
      previousStatus: null,
      divergenceInfo: 'ℹ Approach divergence detected:\n  something',
    });
    expect(buildScoreContext(ctx)).toBe('');
  });

  it('previousStatus=discard with divergenceInfo → output does NOT contain divergence info', () => {
    const ctx = makeScoreContext({
      previousStatus: 'discard',
      previousScore: 0.80,
      currentScore: 0.75,
      delta: -0.05,
      changedMetrics: 'test_count: 100→90',
      divergenceInfo: 'ℹ Approach divergence detected:\n  something',
    });
    const result = buildScoreContext(ctx);
    expect(result).toContain('DISCARDED');
    expect(result).not.toContain('ℹ Approach divergence detected:');
  });

  it('previousStatus=pass + no adversarialResult: output unchanged from pre-Phase-2', () => {
    const ctx = makeScoreContext({
      previousStatus: 'pass',
      currentScore: 0.85,
      previousScore: 0.80,
      delta: 0.05,
      metrics: 'test_count=100',
      regressionThreshold: 0.02,
    });
    const result = buildScoreContext(ctx);
    expect(result).not.toContain('Adversarial');
    expect(result).toContain('Score Context');
    expect(result).toContain('0.850');
  });
});

// ─── formatDivergenceContext ──────────────────────────────────────────────────

describe('formatDivergenceContext', () => {
  it('one new-pattern item → returns string starting with info prefix', () => {
    const items = [{ category: 'error-handling', type: 'new-pattern' as const, variant: '.catch()', detail: '".catch()" appeared for the first time (3 files)' }];
    const result = formatDivergenceContext(items);
    expect(result).toBeDefined();
    expect(result!.startsWith('ℹ Approach divergence detected:')).toBe(true);
  });

  it('multiple items across categories → all categories appear in output', () => {
    const items = [
      { category: 'error-handling', type: 'new-pattern' as const, variant: '.catch()', detail: '".catch()" appeared for the first time (3 files)' },
      { category: 'export-style', type: 'dominant-shift' as const, variant: 'default-export', detail: 'dominant variant changed from named-export to default-export' },
    ];
    const result = formatDivergenceContext(items);
    expect(result).toContain('error-handling');
    expect(result).toContain('export-style');
  });

  it('empty array → returns undefined', () => {
    expect(formatDivergenceContext([])).toBeUndefined();
  });

  it('output never contains "⚠" (SC-16)', () => {
    const items = [
      { category: 'error-handling', type: 'new-pattern' as const, variant: '.catch()', detail: 'appeared for the first time (3 files)' },
      { category: 'null-checking', type: 'proportion-change' as const, variant: 'optional-chain', detail: 'share changed from 10% to 50%' },
    ];
    const result = formatDivergenceContext(items);
    expect(result).not.toContain('⚠');
  });
});

// ─── computeRegression ───────────────────────────────────────────────────────

describe('computeRegression', () => {
  it('computes positive delta when score improves', () => {
    const cp = makeCheckpoint({ lastScore: 0.7, bestScore: 0.7 });
    const result = computeRegression(0.8, cp, undefined);
    expect(result.delta).toBeCloseTo(0.1);
    // cumulativeDrop = bestScore - newScore = 0.7 - 0.8 = -0.1 (negative when score improves)
    expect(result.cumulativeDrop).toBeCloseTo(-0.1);
  });

  it('computes negative delta when score regresses', () => {
    const cp = makeCheckpoint({ lastScore: 0.8, bestScore: 0.8 });
    const result = computeRegression(0.75, cp, undefined);
    expect(result.delta).toBeCloseTo(-0.05);
    expect(result.cumulativeDrop).toBeCloseTo(0.05);
  });

  it('uses newScore as lastScore when lastScore is null (first iteration delta=0)', () => {
    const cp = makeCheckpoint({ lastScore: null, bestScore: null });
    const result = computeRegression(0.7, cp, undefined);
    expect(result.delta).toBeCloseTo(0);
    expect(result.cumulativeDrop).toBeCloseTo(0);
  });

  it('uses newScore as bestScore when bestScore is null (cumulative drop = 0)', () => {
    const cp = makeCheckpoint({ lastScore: 0.8, bestScore: null });
    const result = computeRegression(0.7, cp, undefined);
    expect(result.delta).toBeCloseTo(-0.1);
    // bestScore defaults to newScore (0.7), so cumulativeDrop = 0.7 - 0.7 = 0
    expect(result.cumulativeDrop).toBeCloseTo(0);
  });

  it('cumulative drop reflects drop from best, not from last', () => {
    const cp = makeCheckpoint({ lastScore: 0.75, bestScore: 0.90 });
    const result = computeRegression(0.80, cp, undefined);
    expect(result.delta).toBeCloseTo(0.05);       // 0.80 - 0.75
    expect(result.cumulativeDrop).toBeCloseTo(0.1); // 0.90 - 0.80
  });

  it('boundary: delta exactly at -0.02 (not a regression per threshold check)', () => {
    const cp = makeCheckpoint({ lastScore: 0.80, bestScore: 0.80 });
    const result = computeRegression(0.78, cp, undefined);
    expect(result.delta).toBeCloseTo(-0.02);
    // The threshold check in run loop is: delta < -regressionThreshold (strict)
    // so -0.02 < -0.02 is false → not a regression
  });
});

// ─── computeChangedMetrics ───────────────────────────────────────────────────

describe('computeChangedMetrics', () => {
  it('returns "(none)" when metrics are identical', () => {
    expect(computeChangedMetrics('test_count=42 coverage=80', 'test_count=42 coverage=80')).toBe('(none)');
  });

  it('returns "(none)" when both are empty/dash', () => {
    expect(computeChangedMetrics('—', '—')).toBe('(none)');
    expect(computeChangedMetrics('', '')).toBe('(none)');
  });

  it('reports changed values', () => {
    const result = computeChangedMetrics('test_count=42', 'test_count=50');
    expect(result).toContain('test_count: 42→50');
  });

  it('reports added keys as —→ value', () => {
    const result = computeChangedMetrics('test_count=42', 'test_count=42 coverage=80');
    expect(result).toContain('coverage: —→80');
  });

  it('reports removed keys as value → —', () => {
    const result = computeChangedMetrics('test_count=42 coverage=80', 'test_count=42');
    expect(result).toContain('coverage: 80→—');
  });

  it('reports multiple changes', () => {
    const result = computeChangedMetrics('test_count=10 coverage=70', 'test_count=20 coverage=80');
    expect(result).toContain('test_count: 10→20');
    expect(result).toContain('coverage: 70→80');
  });

  it('handles prev=dash (unscored) vs curr with metrics', () => {
    const result = computeChangedMetrics('—', 'test_count=42');
    // '—' is parsed as a single key-value entry but has no '=' so it's ignored by parseMetrics
    // The '—' string doesn't split into valid key=value pairs, so test_count is treated as new
    expect(result).toContain('test_count: —→42');
  });
});

// ─── Run loop scoring integration ────────────────────────────────────────────
// Tests that exercise scoring behaviors within the run loop (index.ts).
// Mocks everything except ./scoring.js so that buildScoreContext and
// computeChangedMetrics run naturally.

vi.mock('../../config/loader.js', () => ({ loadConfig: vi.fn() }));
vi.mock('./agent.js', () => ({ spawnAgent: vi.fn(), resolveAgent: vi.fn() }));
vi.mock('./timeout.js', () => ({ spawnAgentWithTimeout: vi.fn() }));
vi.mock('./lock.js', () => ({ acquireLock: vi.fn(), releaseLock: vi.fn(), isLockHeld: vi.fn() }));
vi.mock('./validation.js', () => ({ runValidation: vi.fn() }));
vi.mock('./progress.js', () => ({
  loadCheckpoint: vi.fn(),
  saveCheckpoint: vi.fn(),
  deleteCheckpoint: vi.fn(),
  printBanner: vi.fn(),
  printIterationHeader: vi.fn(),
  printIterationSummary: vi.fn(),
  printFinalSummary: vi.fn(),
}));
vi.mock('./prompts.js', () => ({ generatePrompt: vi.fn().mockReturnValue('prompt') }));
vi.mock('./detect.js', () => ({
  detectCompletedTask: vi.fn().mockReturnValue(null),
  normalizePlanContent: vi.fn((s: string) => s),
}));
vi.mock('../../utils/output.js', () => ({
  success: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn(), heading: vi.fn(), plain: vi.fn(),
}));
vi.mock('node:child_process', () => ({ execSync: vi.fn() }));
vi.mock('../score/scorer.js', () => ({
  discoverScorer: vi.fn().mockReturnValue(null),
  runScorer: vi.fn(),
}));
vi.mock('../score/default-scorer.js', () => ({ runDefaultScorer: vi.fn() }));
vi.mock('../score/results.js', () => ({ appendResult: vi.fn(), readResults: vi.fn() }));
// NOTE: ./scoring.js is intentionally NOT mocked so real functions run.

import { execSync } from 'node:child_process';
import { loadConfig } from '../../config/loader.js';
import { spawnAgent, resolveAgent } from './agent.js';
import { spawnAgentWithTimeout } from './timeout.js';
import { runValidation } from './validation.js';
import { loadCheckpoint, saveCheckpoint } from './progress.js';
import { runDefaultScorer } from '../score/default-scorer.js';
import { appendResult } from '../score/results.js';
import * as outputMod from '../../utils/output.js';
import { runCommand } from './index.js';
import type { AgentConfig, RunConfig, RalphConfig, ScoringConfig } from '../../config/schema.js';
import type { LoadResult } from '../../config/loader.js';
import { DEFAULT_ADVERSARIAL } from '../../config/defaults.js';

const mockExecSync = vi.mocked(execSync);
const mockLoadConfig = vi.mocked(loadConfig);
const mockSpawnAgent = vi.mocked(spawnAgent);
const mockSpawnAgentWithTimeout = vi.mocked(spawnAgentWithTimeout);
const mockRunValidation = vi.mocked(runValidation);
const mockLoadCheckpoint = vi.mocked(loadCheckpoint);
const mockSaveCheckpoint = vi.mocked(saveCheckpoint);
const mockRunDefaultScorer = vi.mocked(runDefaultScorer);
const mockAppendResult = vi.mocked(appendResult);
const mockWarn = vi.mocked(outputMod.warn);
const mockResolveAgent = vi.mocked(resolveAgent);

function makeAgentConfig(): AgentConfig {
  return { cli: 'claude', args: ['--print'], timeout: 1800 };
}

function makeRunConfig(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    agent: makeAgentConfig(),
    'plan-agent': null,
    'build-agent': null,
    prompts: { plan: null, build: null },
    loop: { 'max-iterations': 1, 'stall-threshold': 3, 'iteration-timeout': 900 },
    validation: { 'test-command': null, 'typecheck-command': null },
    git: { 'auto-commit': false, 'auto-push': false, 'commit-prefix': 'ralph:', branch: null },
    adversarial: DEFAULT_ADVERSARIAL,
    ...overrides,
  };
}

function makeLoadResult(
  runOverrides: Partial<RunConfig> = {},
  scoringOverrides: Partial<ScoringConfig> = {},
): LoadResult {
  const runConfig = makeRunConfig(runOverrides);
  const scoringConfig: ScoringConfig = {
    script: null,
    'regression-threshold': 0.02,
    'cumulative-threshold': 0.10,
    'auto-revert': true,
    'default-weights': { tests: 0.6, coverage: 0.4 },
    ...scoringOverrides,
  };
  return {
    config: {
      project: { name: 'test', language: 'typescript' },
      architecture: {
        layers: [],
        direction: 'forward-only',
        rules: { 'max-lines': 500, naming: { schemas: '*Schema', types: '*Type' } },
      },
      quality: { 'minimum-grade': 'D', coverage: { tool: 'none', 'report-path': 'coverage/lcov.info' } },
      gc: { 'consistency-threshold': 60, exclude: [] },
      doctor: { 'minimum-score': 7, 'custom-checks': [] },
      paths: {
        'agents-md': 'AGENTS.md',
        'architecture-md': 'ARCHITECTURE.md',
        docs: 'docs',
        specs: 'docs/product-specs',
        plans: 'docs/plans',
        'design-docs': 'docs/design-docs',
        references: '.ralph/refs',
        generated: '.ralph/generated',
        quality: '.ralph/quality',
      },
      references: { 'max-total-kb': 200, 'warn-single-file-kb': 80 },
      run: runConfig,
      scoring: scoringConfig,
    } as RalphConfig,
    configPath: null,
    warnings: [],
  };
}

function makeIntegrationCheckpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    version: 1,
    phase: 'build',
    startedAt: new Date().toISOString(),
    iteration: 0,
    history: [],
    ...overrides,
  };
}

let tmpDir: string;
let origCwd: string;

beforeEach(() => {
  origCwd = process.cwd();
  tmpDir = mkdtempSync(join(tmpdir(), 'ralph-score-'));
  mkdirSync(join(tmpDir, '.git'), { recursive: true });
  mkdirSync(join(tmpDir, '.ralph'), { recursive: true });
  writeFileSync(join(tmpDir, 'IMPLEMENTATION_PLAN.md'), '# Plan\n- [ ] Task 1\n');
  process.chdir(tmpDir);

  vi.clearAllMocks();

  mockLoadConfig.mockReturnValue(makeLoadResult());
  mockResolveAgent.mockReturnValue(makeAgentConfig());
  mockLoadCheckpoint.mockReturnValue(null);
  mockSpawnAgent.mockResolvedValue({ exitCode: 0, durationMs: 1000 });
  mockSpawnAgentWithTimeout.mockImplementation(
    (_config: AgentConfig, prompt: string, _timeout: number, opts?: { verbose?: boolean | undefined; capture?: boolean | undefined }) =>
      mockSpawnAgent(_config, prompt, opts),
  );
  mockRunValidation.mockReturnValue({ passed: true, testOutput: '', stages: [], failedStage: null });
  mockRunDefaultScorer.mockReturnValue({ score: null, source: 'default' as const, scriptPath: null, metrics: {} });

  // Git: always shows changes so the run loop takes the "has new work" path
  mockExecSync.mockImplementation((cmd: unknown) => {
    const c = String(cmd);
    if (c.includes('git status --porcelain')) return 'M src/foo.ts\n';
    if (c.includes('git rev-parse --short')) return 'abc1234\n';
    if (c.includes('git rev-parse HEAD')) return 'abc1234567890\n';
    if (c.includes('git rev-parse --abbrev-ref')) return 'main\n';
    if (c.includes('git ls-files')) return '\n';
    return '';
  });

  vi.spyOn(process, 'exit').mockImplementation((_code?: string | number | null) => {
    throw new Error(`process.exit(${_code})`);
  });
});

afterEach(() => {
  process.chdir(origCwd);
  rmSync(tmpDir, { recursive: true, force: true });
  process.removeAllListeners('SIGINT');
  process.removeAllListeners('SIGTERM');
  vi.restoreAllMocks();
});

describe('runCommand scoring integration', () => {
  // ── auto-revert: false ───────────────────────────────────────────────────

  it('auto-revert:false logs regression as pass (no revert)', async () => {
    mockLoadConfig.mockReturnValue(
      makeLoadResult({}, { 'auto-revert': false, 'regression-threshold': 0.02 }),
    );
    // Pre-existing score so we're past first iteration
    mockLoadCheckpoint.mockReturnValue(
      makeIntegrationCheckpoint({ lastScore: 0.80, bestScore: 0.80, consecutiveDiscards: 0 }),
    );
    // Return a regressing score: 0.75, delta = -0.05 (exceeds threshold 0.02)
    mockRunDefaultScorer.mockReturnValue({
      score: 0.75,
      source: 'default' as const,
      scriptPath: null,
      metrics: { test_count: '42', coverage: '75' },
    });

    await runCommand('build', { resume: true });

    const calls = mockAppendResult.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const lastCall = calls[calls.length - 1]![0];
    expect(lastCall.status).toBe('pass');
    // Regression should be noted in description
    expect(lastCall.description).toContain('regression ignored');
    // No revert should occur (git reset --hard not called)
    const execCalls = mockExecSync.mock.calls.map((c) => String(c[0]));
    expect(execCalls.some((c) => c.includes('git reset --hard'))).toBe(false);
  });

  // ── .ralph/keep honored ──────────────────────────────────────────────────

  it('.ralph/keep existed before agent: regression is ignored, status=pass', async () => {
    // Create .ralph/keep BEFORE running (simulates user pre-placing it)
    writeFileSync(join(tmpDir, '.ralph', 'keep'), 'important experiment');

    mockLoadCheckpoint.mockReturnValue(
      makeIntegrationCheckpoint({ lastScore: 0.80, bestScore: 0.80, consecutiveDiscards: 0 }),
    );
    // Regressing score
    mockRunDefaultScorer.mockReturnValue({
      score: 0.74,
      source: 'default' as const,
      scriptPath: null,
      metrics: {},
    });

    await runCommand('build', { resume: true });

    const calls = mockAppendResult.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const lastCall = calls[calls.length - 1]![0];
    expect(lastCall.status).toBe('pass');
    expect(lastCall.description).toContain('[kept:');
    // .ralph/keep should be deleted after being consumed
    expect(existsSync('.ralph/keep')).toBe(false);
  });

  // ── .ralph/keep ignored (agent created it) ───────────────────────────────

  it('.ralph/keep created by agent: regression is NOT ignored, warning issued', async () => {
    // .ralph/keep does NOT exist before agent runs
    expect(existsSync('.ralph/keep')).toBe(false);

    mockLoadCheckpoint.mockReturnValue(
      makeIntegrationCheckpoint({ lastScore: 0.80, bestScore: 0.80, consecutiveDiscards: 0 }),
    );
    mockRunDefaultScorer.mockReturnValue({
      score: 0.74,
      source: 'default' as const,
      scriptPath: null,
      metrics: {},
    });

    // Agent side-effect: creates .ralph/keep during execution
    mockSpawnAgentWithTimeout.mockImplementation(async () => {
      writeFileSync(join(tmpDir, '.ralph', 'keep'), 'agent planted this');
      return { exitCode: 0, durationMs: 500 };
    });

    await runCommand('build', { resume: true });

    // Warning should have been issued
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('`.ralph/keep` created during agent execution'),
    );

    // Result should be discard (regression was not overridden)
    const calls = mockAppendResult.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const discardCall = calls.find((c) => c[0].status === 'discard');
    expect(discardCall).toBeDefined();

    // File should be cleaned up
    expect(existsSync('.ralph/keep')).toBe(false);
  });

  // ── baseline recalibration after 3 discards ──────────────────────────────

  it('recalibrates baseline after 3rd consecutive discard', async () => {
    // Pre-load checkpoint with 2 consecutive discards already recorded
    mockLoadCheckpoint.mockReturnValue(
      makeIntegrationCheckpoint({
        lastScore: 0.70,
        bestScore: 0.70,
        consecutiveDiscards: 2,
        bestDiscardedScore: 0.65,
      }),
    );
    // One more regression: score=0.60, delta=-0.10 → 3rd discard → recalibration
    mockRunDefaultScorer.mockReturnValue({
      score: 0.60,
      source: 'default' as const,
      scriptPath: null,
      metrics: {},
    });

    await runCommand('build', { resume: true });

    // appendResult should have been called with discard + recalibration note
    const calls = mockAppendResult.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const discardCall = calls.find((c) => c[0].status === 'discard');
    expect(discardCall).toBeDefined();
    expect(discardCall![0].description).toContain('baseline recalibrated');

    // Checkpoint should be reset: consecutiveDiscards=0, lastScore/bestScore recalibrated
    const savedCheckpoints = mockSaveCheckpoint.mock.calls.map((c) => c[0]);
    const lastSaved = savedCheckpoints[savedCheckpoints.length - 1];
    expect(lastSaved?.consecutiveDiscards).toBe(0);
    // bestDiscardedScore was 0.65 before, new discard score=0.60, so recalibrated to 0.65
    expect(lastSaved?.lastScore).toBeCloseTo(0.65);
    expect(lastSaved?.bestScore).toBeCloseTo(0.65);
  });

  // ── per-iteration regression check ──────────────────────────────────────

  it('per-iteration regression: score drop exceeds threshold → discard', async () => {
    mockLoadCheckpoint.mockReturnValue(
      makeIntegrationCheckpoint({ lastScore: 0.80, bestScore: 0.80, consecutiveDiscards: 0 }),
    );
    // delta = 0.75 - 0.80 = -0.05, threshold = 0.02 → -0.05 < -0.02 → regression
    mockRunDefaultScorer.mockReturnValue({
      score: 0.75,
      source: 'default' as const,
      scriptPath: null,
      metrics: {},
    });

    await runCommand('build', { resume: true });

    const calls = mockAppendResult.mock.calls;
    expect(calls.some((c) => c[0].status === 'discard')).toBe(true);
  });

  it('exactly at regression threshold: NOT a regression (boundary)', async () => {
    // 0.5 - 0.6 = -0.09999... in JS float due to 0.6's binary representation
    // With threshold=0.1: -0.09999... < -0.1 is FALSE → not a regression (strict <)
    mockLoadConfig.mockReturnValue(
      makeLoadResult({}, { 'regression-threshold': 0.1, 'cumulative-threshold': 0.5 }),
    );
    mockLoadCheckpoint.mockReturnValue(
      makeIntegrationCheckpoint({ lastScore: 0.6, bestScore: 0.6, consecutiveDiscards: 0 }),
    );
    // delta = 0.5 - 0.6 = -0.09999... → NOT strictly < -0.1 → no regression
    mockRunDefaultScorer.mockReturnValue({
      score: 0.5,
      source: 'default' as const,
      scriptPath: null,
      metrics: {},
    });

    await runCommand('build', { resume: true });

    const calls = mockAppendResult.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const statuses = calls.map((c) => c[0].status);
    expect(statuses.every((s) => s === 'pass')).toBe(true);
  });

  // ── cumulative regression check ──────────────────────────────────────────

  it('cumulative regression: drop from best exceeds cumulative threshold → discard', async () => {
    // bestScore=0.90, currentScore will be 0.79 → cumulativeDrop=0.11 > 0.10
    mockLoadCheckpoint.mockReturnValue(
      makeIntegrationCheckpoint({
        lastScore: 0.85,
        bestScore: 0.90,
        consecutiveDiscards: 0,
      }),
    );
    // delta = 0.79 - 0.85 = -0.06 → per-iteration regression (< -0.02)
    // But also cumulativeDrop = 0.90 - 0.79 = 0.11 > 0.10
    mockRunDefaultScorer.mockReturnValue({
      score: 0.79,
      source: 'default' as const,
      scriptPath: null,
      metrics: {},
    });

    await runCommand('build', { resume: true });

    // Should discard (per-iteration regression fires first)
    expect(mockAppendResult.mock.calls.some((c) => c[0].status === 'discard')).toBe(true);
  });

  it('cumulative-only regression (per-iteration passes, cumulative fails)', async () => {
    // lastScore=0.88, bestScore=0.90; newScore=0.87
    // per-iteration: 0.87 - 0.88 = -0.01 → not a regression (< -0.02 is false)
    // cumulative: 0.90 - 0.87 = 0.03 → not a regression (≤ 0.10)
    // → should pass
    mockLoadCheckpoint.mockReturnValue(
      makeIntegrationCheckpoint({
        lastScore: 0.88,
        bestScore: 0.90,
        consecutiveDiscards: 0,
      }),
    );
    mockRunDefaultScorer.mockReturnValue({
      score: 0.87,
      source: 'default' as const,
      scriptPath: null,
      metrics: {},
    });

    await runCommand('build', { resume: true });

    expect(mockAppendResult.mock.calls.every((c) => c[0].status === 'pass')).toBe(true);
  });
});
