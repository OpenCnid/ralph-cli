import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../../config/loader.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('./agent.js', () => ({
  spawnAgent: vi.fn(),
  resolveAgent: vi.fn(),
}));

vi.mock('./progress.js', () => ({
  loadCheckpoint: vi.fn(),
  saveCheckpoint: vi.fn(),
  deleteCheckpoint: vi.fn(),
  printBanner: vi.fn(),
  printIterationHeader: vi.fn(),
  printIterationSummary: vi.fn(),
  printFinalSummary: vi.fn(),
}));

vi.mock('./prompts.js', () => ({
  generatePrompt: vi.fn().mockReturnValue('generated prompt'),
}));

vi.mock('./detect.js', () => ({
  detectCompletedTask: vi.fn().mockReturnValue(null),
  normalizePlanContent: vi.fn((s: string) => s),
  composeValidateCommand: vi.fn().mockReturnValue('npm test && npx tsc --noEmit'),
}));

vi.mock('../../utils/output.js', () => ({
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  heading: vi.fn(),
  plain: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('./timeout.js', () => ({
  spawnAgentWithTimeout: vi.fn(),
}));

vi.mock('./lock.js', () => ({
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
  isLockHeld: vi.fn(),
}));

vi.mock('./validation.js', () => ({
  runValidation: vi.fn(),
}));

vi.mock('../score/scorer.js', () => ({
  discoverScorer: vi.fn().mockReturnValue(null),
  runScorer: vi.fn(),
}));

vi.mock('../score/default-scorer.js', () => ({
  runDefaultScorer: vi.fn(),
}));

vi.mock('../score/results.js', () => ({
  appendResult: vi.fn(),
  readResults: vi.fn(),
}));

vi.mock('./scoring.js', () => ({
  buildScoreContext: vi.fn().mockReturnValue(''),
  computeChangedMetrics: vi.fn().mockReturnValue('(none)'),
  computeRegression: vi.fn(),
}));

// ─── Imports after mocks ─────────────────────────────────────────────────────

import { execSync } from 'node:child_process';
import { loadConfig } from '../../config/loader.js';
import { spawnAgent, resolveAgent } from './agent.js';
import { spawnAgentWithTimeout } from './timeout.js';
import { runValidation } from './validation.js';
import { runDefaultScorer } from '../score/default-scorer.js';
import { loadCheckpoint, saveCheckpoint, printFinalSummary, printIterationHeader } from './progress.js';
import { generatePrompt } from './prompts.js';
import * as outputMod from '../../utils/output.js';
import { runCommand } from './index.js';
import type { RunConfig, RalphConfig, AgentConfig } from '../../config/schema.js';
import type { Checkpoint } from './progress.js';
import type { LoadResult } from '../../config/loader.js';
import { DEFAULT_ADVERSARIAL } from '../../config/defaults.js';

const mockExecSync = vi.mocked(execSync);
const mockLoadConfig = vi.mocked(loadConfig);
const mockSpawnAgent = vi.mocked(spawnAgent);
const mockSpawnAgentWithTimeout = vi.mocked(spawnAgentWithTimeout);
const mockRunValidation = vi.mocked(runValidation);
const mockRunDefaultScorer = vi.mocked(runDefaultScorer);
const mockResolveAgent = vi.mocked(resolveAgent);
const mockLoadCheckpoint = vi.mocked(loadCheckpoint);
const mockSaveCheckpoint = vi.mocked(saveCheckpoint);
const mockPrintFinalSummary = vi.mocked(printFinalSummary);
const mockPrintIterationHeader = vi.mocked(printIterationHeader);
const mockGeneratePrompt = vi.mocked(generatePrompt);
const mockWarn = vi.mocked(outputMod.warn);
const mockPlain = vi.mocked(outputMod.plain);
const mockError = vi.mocked(outputMod.error);

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
    git: { 'auto-commit': true, 'auto-push': false, 'commit-prefix': 'ralph:', branch: null },
    adversarial: DEFAULT_ADVERSARIAL,
    ...overrides,
  };
}

function makeLoadResult(runOverrides: Partial<RunConfig> = {}): LoadResult {
  const runConfig = makeRunConfig(runOverrides);
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
    } as RalphConfig,
    configPath: null,
    warnings: [],
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

// ─── Test setup ──────────────────────────────────────────────────────────────

let tmpDir: string;
let origCwd: string;
let mockExit: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  origCwd = process.cwd();
  tmpDir = mkdtempSync(join(tmpdir(), 'ralph-run-'));
  mkdirSync(join(tmpDir, '.git'), { recursive: true });
  // Create IMPLEMENTATION_PLAN.md so build mode doesn't warn
  writeFileSync(join(tmpDir, 'IMPLEMENTATION_PLAN.md'), '# Plan\n- [ ] Task 1\n');
  process.chdir(tmpDir);

  vi.clearAllMocks();

  // Re-apply defaults after clearAllMocks
  mockLoadConfig.mockReturnValue(makeLoadResult());
  mockResolveAgent.mockReturnValue(makeAgentConfig());
  mockLoadCheckpoint.mockReturnValue(null);
  mockSpawnAgent.mockResolvedValue({ exitCode: 0, durationMs: 1000 });

  // spawnAgentWithTimeout delegates to spawnAgent so existing assertions still work
  mockSpawnAgentWithTimeout.mockImplementation(
    (_config: AgentConfig, prompt: string, _timeout: number, opts?: { verbose?: boolean | undefined; capture?: boolean | undefined }) =>
      mockSpawnAgent(_config, prompt, opts),
  );

  // Validation passes by default
  mockRunValidation.mockReturnValue({ passed: true, testOutput: '', stages: [], failedStage: null });

  // Default scorer returns no score
  mockRunDefaultScorer.mockReturnValue({ score: null, source: 'default' as const, scriptPath: null, metrics: {} });

  // git: no changes by default
  mockExecSync.mockImplementation((cmd: unknown) => {
    const c = String(cmd);
    if (c.includes('git status --porcelain')) return '';
    if (c.includes('git rev-parse --short')) return 'abc1234\n';
    return '';
  });

  mockExit = vi.spyOn(process, 'exit').mockImplementation((_code?: string | number | null) => {
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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('runCommand — build mode', () => {
  it('single iteration: agent succeeds, checkpoint updated', async () => {
    await runCommand('build', {});

    expect(mockSpawnAgent).toHaveBeenCalledOnce();
    expect(mockSaveCheckpoint).toHaveBeenCalled();

    const saved = mockSaveCheckpoint.mock.calls[0]?.[0] as Checkpoint;
    expect(saved.iteration).toBe(1);
    expect(saved.history).toHaveLength(1);
    expect(saved.history[0]?.exitCode).toBe(0);
    expect(saved.history[0]?.durationMs).toBe(1000);
  });

  it('single iteration with changes: commits and updates checkpoint', async () => {
    mockExecSync.mockImplementation((cmd: unknown) => {
      const c = String(cmd);
      if (c.includes('git status --porcelain')) return 'M src/foo.ts\n';
      if (c.includes('git rev-parse --short')) return 'deadbee\n';
      return '';
    });

    await runCommand('build', {});

    // git add -A and git commit should be called
    const calls = mockExecSync.mock.calls.map((c) => String(c[0]));
    expect(calls.some((c) => c.includes('git add -A'))).toBe(true);
    expect(calls.some((c) => c.includes('git commit'))).toBe(true);

    const saved = mockSaveCheckpoint.mock.calls.at(-1)?.[0] as Checkpoint;
    expect(saved.history[0]?.commit).toBe('deadbee');
  });

  it('max iterations stops loop', async () => {
    mockLoadConfig.mockReturnValue(makeLoadResult({
      loop: { 'max-iterations': 2, 'stall-threshold': 3, 'iteration-timeout': 900 },
    }));
    mockSpawnAgent.mockResolvedValue({ exitCode: 0, durationMs: 500 });

    await runCommand('build', {});

    expect(mockSpawnAgent).toHaveBeenCalledTimes(2);
    expect(mockPrintFinalSummary).toHaveBeenCalledWith(
      'max iterations reached',
      expect.any(Object),
    );
  });

  it('--dry-run prints prompt and does not spawn agent', async () => {
    await runCommand('build', { dryRun: true });

    expect(mockSpawnAgent).not.toHaveBeenCalled();
    expect(mockPlain).toHaveBeenCalledWith('generated prompt');
  });

  it('--no-commit skips git operations', async () => {
    mockExecSync.mockImplementation((cmd: unknown) => {
      const c = String(cmd);
      // Return changes so commit would be triggered without --no-commit
      if (c.includes('git status --porcelain')) return 'M src/foo.ts\n';
      if (c.includes('git rev-parse --short')) return 'abc1234\n';
      return '';
    });

    await runCommand('build', { noCommit: true });

    const calls = mockExecSync.mock.calls.map((c) => String(c[0]));
    expect(calls.some((c) => c.includes('git commit'))).toBe(false);
    expect(calls.some((c) => c.includes('git add -A'))).toBe(false);
  });

  it('agent non-zero exit code produces warning but loop continues', async () => {
    mockSpawnAgent.mockResolvedValue({ exitCode: 1, durationMs: 500 });

    await runCommand('build', {});

    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('exited with code 1'));
  });

  it('agent spawn failure produces warning', async () => {
    mockSpawnAgent.mockResolvedValue({ exitCode: 1, durationMs: 0, error: 'Agent CLI "bad" not found' });

    await runCommand('build', {});

    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('Agent spawn failed'));
  });

  it('stall detection halts loop in non-TTY after threshold no-change iterations', async () => {
    // 3 iterations, no changes each time → stall after 3
    mockLoadConfig.mockReturnValue(makeLoadResult({
      loop: { 'max-iterations': 0, 'stall-threshold': 3, 'iteration-timeout': 900 },
    }));
    mockSpawnAgent.mockResolvedValue({ exitCode: 0, durationMs: 100 });
    // git status always returns empty (no changes)
    mockExecSync.mockReturnValue('');

    await runCommand('build', {});

    expect(mockSpawnAgent).toHaveBeenCalledTimes(3);
    expect(mockPrintFinalSummary).toHaveBeenCalledWith(
      expect.stringContaining('stalled'),
      expect.any(Object),
    );
  });

  it('stall detection disabled when threshold is 0', async () => {
    mockLoadConfig.mockReturnValue(makeLoadResult({
      loop: { 'max-iterations': 5, 'stall-threshold': 0, 'iteration-timeout': 900 },
    }));
    mockSpawnAgent.mockResolvedValue({ exitCode: 0, durationMs: 100 });
    mockExecSync.mockReturnValue(''); // no changes

    await runCommand('build', {});

    // Should run all 5 iterations without stalling
    expect(mockSpawnAgent).toHaveBeenCalledTimes(5);
    expect(mockPrintFinalSummary).toHaveBeenCalledWith('max iterations reached', expect.any(Object));
  });

  it('--resume continues from checkpoint iteration count', async () => {
    const existingCheckpoint = makeCheckpoint({
      iteration: 3,
      history: [
        { iteration: 1, durationMs: 1000, exitCode: 0, commit: 'aaa1111' },
        { iteration: 2, durationMs: 1000, exitCode: 0, commit: 'bbb2222' },
        { iteration: 3, durationMs: 1000, exitCode: 0, commit: 'ccc3333' },
      ],
    });
    mockLoadCheckpoint.mockReturnValue(existingCheckpoint);
    // max-iterations = 4 → should only run iteration 4
    mockLoadConfig.mockReturnValue(makeLoadResult({
      loop: { 'max-iterations': 4, 'stall-threshold': 3, 'iteration-timeout': 900 },
    }));

    await runCommand('build', { resume: true });

    expect(mockSpawnAgent).toHaveBeenCalledTimes(1);
    expect(mockPrintIterationHeader).toHaveBeenCalledWith(4);
  });

  it('--resume with no existing checkpoint starts fresh', async () => {
    mockLoadCheckpoint.mockReturnValue(null);

    await runCommand('build', { resume: true });

    expect(mockSpawnAgent).toHaveBeenCalledOnce();
    expect(mockPrintIterationHeader).toHaveBeenCalledWith(1);
  });

  it('auto-push calls git push when enabled', async () => {
    mockLoadConfig.mockReturnValue(makeLoadResult({
      git: { 'auto-commit': true, 'auto-push': true, 'commit-prefix': 'ralph:', branch: null },
    }));
    mockExecSync.mockImplementation((cmd: unknown) => {
      const c = String(cmd);
      if (c.includes('git status --porcelain')) return 'M foo.ts\n';
      if (c.includes('git rev-parse --short')) return 'abc1234\n';
      return '';
    });

    await runCommand('build', {});

    const calls = mockExecSync.mock.calls.map((c) => String(c[0]));
    expect(calls.some((c) => c.includes('git push'))).toBe(true);
  });

  it('--no-push skips git push even when auto-push is enabled', async () => {
    mockLoadConfig.mockReturnValue(makeLoadResult({
      git: { 'auto-commit': true, 'auto-push': true, 'commit-prefix': 'ralph:', branch: null },
    }));
    mockExecSync.mockImplementation((cmd: unknown) => {
      const c = String(cmd);
      if (c.includes('git status --porcelain')) return 'M foo.ts\n';
      if (c.includes('git rev-parse --short')) return 'abc1234\n';
      return '';
    });

    await runCommand('build', { noPush: true });

    const calls = mockExecSync.mock.calls.map((c) => String(c[0]));
    expect(calls.some((c) => c.includes('git push'))).toBe(false);
  });

  it('--max overrides loop.max-iterations from config', async () => {
    // Config has max-iterations 1, --max 3 → runs 3
    mockLoadConfig.mockReturnValue(makeLoadResult({
      loop: { 'max-iterations': 1, 'stall-threshold': 0, 'iteration-timeout': 900 },
    }));

    await runCommand('build', { max: 3 });

    expect(mockSpawnAgent).toHaveBeenCalledTimes(3);
  });

  it('no IMPLEMENTATION_PLAN.md in non-TTY: warns and continues', async () => {
    // Remove the plan file we created in beforeEach
    const { unlinkSync } = await import('node:fs');
    unlinkSync(join(tmpDir, 'IMPLEMENTATION_PLAN.md'));

    await runCommand('build', {});

    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('No IMPLEMENTATION_PLAN.md'));
    expect(mockSpawnAgent).toHaveBeenCalledOnce();
  });
});

describe('runCommand — plan mode', () => {
  beforeEach(() => {
    // Create specs dir with a file
    const specsDir = join(tmpDir, 'docs', 'product-specs');
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, 'spec.md'), '# Spec\n');
  });

  it('plan mode halts when plan file unchanged after iteration', async () => {
    // normalizePlanContent is identity mock, so same content = unchanged
    mockLoadConfig.mockReturnValue(makeLoadResult({
      loop: { 'max-iterations': 0, 'stall-threshold': 3, 'iteration-timeout': 900 },
    }));

    await runCommand('plan', {});

    expect(mockPrintFinalSummary).toHaveBeenCalledWith('plan complete', expect.any(Object));
    expect(mockSpawnAgent).toHaveBeenCalledOnce();
  });

  it('plan mode errors when specs dir is missing', async () => {
    // Remove specs dir
    rmSync(join(tmpDir, 'docs'), { recursive: true, force: true });

    await expect(runCommand('plan', {})).rejects.toThrow('process.exit(1)');
    expect(mockError).toHaveBeenCalledWith(expect.stringContaining('No specs found'));
  });

  it('plan mode errors when specs dir is empty', async () => {
    const specsDir = join(tmpDir, 'docs', 'product-specs');
    const { readdirSync, unlinkSync } = await import('node:fs');
    for (const f of readdirSync(specsDir)) {
      unlinkSync(join(specsDir, f));
    }

    await expect(runCommand('plan', {})).rejects.toThrow('process.exit(1)');
    expect(mockError).toHaveBeenCalledWith(expect.stringContaining('No specs found'));
  });

  it('plan mode: continues without prompt in non-TTY when plan exists', async () => {
    // IMPLEMENTATION_PLAN.md already exists (created in top-level beforeEach)
    mockLoadConfig.mockReturnValue(makeLoadResult({
      loop: { 'max-iterations': 1, 'stall-threshold': 3, 'iteration-timeout': 900 },
    }));

    await runCommand('plan', {});

    // Should run without throwing (non-TTY skips confirmation)
    expect(mockSpawnAgent).toHaveBeenCalledOnce();
  });

  it('plan mode with --resume skips plan-exists confirmation', async () => {
    const existingCheckpoint = makeCheckpoint({ phase: 'plan', iteration: 1 });
    mockLoadCheckpoint.mockReturnValue(existingCheckpoint);
    mockLoadConfig.mockReturnValue(makeLoadResult({
      loop: { 'max-iterations': 2, 'stall-threshold': 3, 'iteration-timeout': 900 },
    }));

    await runCommand('plan', { resume: true });

    expect(mockSpawnAgent).toHaveBeenCalledOnce();
  });
});

describe('runCommand — phase mismatch on --resume', () => {
  it('non-TTY: exits with error when checkpoint phase mismatches', async () => {
    const existingCheckpoint = makeCheckpoint({ phase: 'plan', iteration: 2 });
    mockLoadCheckpoint.mockReturnValue(existingCheckpoint);

    await expect(runCommand('build', { resume: true })).rejects.toThrow('process.exit(1)');
    expect(mockError).toHaveBeenCalledWith(expect.stringContaining('phase mismatch'));
  });
});

describe('runCommand — dirty working tree', () => {
  it('non-TTY: warns and continues when dirty tree and auto-commit enabled', async () => {
    // git status returns dirty on first call, then clean afterwards
    let statusCallCount = 0;
    mockExecSync.mockImplementation((cmd: unknown) => {
      const c = String(cmd);
      if (c.includes('git status --porcelain')) {
        statusCallCount++;
        return statusCallCount === 1 ? 'M dirty.ts\n' : ''; // dirty on first check only
      }
      if (c.includes('git rev-parse --short')) return 'abc1234\n';
      return '';
    });

    await runCommand('build', {});

    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('uncommitted changes'));
    expect(mockSpawnAgent).toHaveBeenCalledOnce();
  });

  it('--no-commit skips dirty tree check', async () => {
    // With --no-commit, effectiveAutoCommit is false, so hasChanges() is never called for dirty check
    mockExecSync.mockImplementation((_cmd: unknown) => {
      // Should not reach git status for dirty tree check
      return '';
    });

    await runCommand('build', { noCommit: true });

    // No warn about dirty tree
    const dirtyWarnings = mockWarn.mock.calls.filter((c) =>
      String(c[0]).includes('uncommitted'),
    );
    expect(dirtyWarnings).toHaveLength(0);
  });
});
