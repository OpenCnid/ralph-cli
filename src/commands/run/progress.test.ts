import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../../utils/output.js', () => ({
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  heading: vi.fn(),
  plain: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execSync: vi.fn().mockReturnValue('main\n'),
  spawn: vi.fn(),
}));

import * as outputMod from '../../utils/output.js';
import { execSync } from 'node:child_process';
import {
  loadCheckpoint,
  saveCheckpoint,
  deleteCheckpoint,
  formatDuration,
  printBanner,
  printIterationHeader,
  printIterationSummary,
  printFinalSummary,
} from './progress.js';
import type { Checkpoint } from './progress.js';
import type { AgentConfig, RunConfig } from '../../config/schema.js';

const mockWarn = vi.mocked(outputMod.warn);
const mockInfo = vi.mocked(outputMod.info);
const mockHeading = vi.mocked(outputMod.heading);
const mockExecSync = vi.mocked(execSync);

let origCwd: string;
let tmpDir: string;

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ralph-progress-'));
  mkdirSync(join(dir, '.git'), { recursive: true });
  return dir;
}

beforeEach(() => {
  origCwd = process.cwd();
  vi.clearAllMocks();
  tmpDir = makeTempDir();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(origCwd);
  rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Checkpoint helpers ───────────────────────────────────────────────────────

function baseCheckpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
  return {
    version: 1,
    phase: 'build',
    startedAt: '2026-03-09T00:00:00.000Z',
    iteration: 3,
    history: [],
    ...overrides,
  };
}

function makeRunConfig(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    agent: { cli: 'claude', args: ['--print'], timeout: 1800 },
    'plan-agent': null,
    'build-agent': null,
    prompts: { plan: null, build: null },
    loop: { 'max-iterations': 10, 'stall-threshold': 3, 'iteration-timeout': 900 },
    validation: { 'test-command': null, 'typecheck-command': null },
    git: { 'auto-commit': true, 'auto-push': false, 'commit-prefix': 'ralph:', branch: null },
    ...overrides,
  };
}

// ─── loadCheckpoint / saveCheckpoint / deleteCheckpoint ──────────────────────

describe('loadCheckpoint', () => {
  it('returns null when checkpoint file does not exist', () => {
    const result = loadCheckpoint();
    expect(result).toBeNull();
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('save/load round-trip preserves all fields', () => {
    const cp = baseCheckpoint({
      phase: 'plan',
      iteration: 5,
      history: [
        { iteration: 1, durationMs: 3000, exitCode: 0, commit: 'abc1234' },
        { iteration: 2, durationMs: 5000, exitCode: 1, commit: null, error: 'timeout' },
      ],
    });

    saveCheckpoint(cp);
    const loaded = loadCheckpoint();

    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(1);
    expect(loaded!.phase).toBe('plan');
    expect(loaded!.iteration).toBe(5);
    expect(loaded!.startedAt).toBe('2026-03-09T00:00:00.000Z');
    expect(loaded!.history).toHaveLength(2);
    expect(loaded!.history[0]).toEqual({ iteration: 1, durationMs: 3000, exitCode: 0, commit: 'abc1234' });
    expect(loaded!.history[1]).toEqual({ iteration: 2, durationMs: 5000, exitCode: 1, commit: null, error: 'timeout' });
  });

  it('version mismatch: deletes file, warns, returns null', () => {
    mkdirSync('.ralph', { recursive: true });
    writeFileSync('.ralph/run-checkpoint.json', JSON.stringify({ version: 2, phase: 'build' }));

    const result = loadCheckpoint();

    expect(result).toBeNull();
    expect(existsSync('.ralph/run-checkpoint.json')).toBe(false);
    expect(mockWarn).toHaveBeenCalledWith(
      'Incompatible checkpoint format (version 2), starting fresh.',
    );
  });

  it('version undefined: warns with "undefined" and returns null', () => {
    mkdirSync('.ralph', { recursive: true });
    writeFileSync('.ralph/run-checkpoint.json', JSON.stringify({ phase: 'build' }));

    const result = loadCheckpoint();

    expect(result).toBeNull();
    expect(mockWarn).toHaveBeenCalledWith(
      'Incompatible checkpoint format (version undefined), starting fresh.',
    );
  });
});

describe('saveCheckpoint', () => {
  it('creates .ralph dir if it does not exist', () => {
    const cp = baseCheckpoint();
    saveCheckpoint(cp);
    expect(existsSync('.ralph/run-checkpoint.json')).toBe(true);
  });

  it('writes with 2-space indent', () => {
    const cp = baseCheckpoint();
    saveCheckpoint(cp);
    const raw = readFileSync('.ralph/run-checkpoint.json', 'utf8');
    expect(raw).toContain('  "version"');
  });
});

describe('deleteCheckpoint', () => {
  it('deletes an existing checkpoint', () => {
    saveCheckpoint(baseCheckpoint());
    expect(existsSync('.ralph/run-checkpoint.json')).toBe(true);

    deleteCheckpoint();
    expect(existsSync('.ralph/run-checkpoint.json')).toBe(false);
  });

  it('does not throw when file does not exist', () => {
    expect(() => deleteCheckpoint()).not.toThrow();
  });
});

// ─── formatDuration ───────────────────────────────────────────────────────────

describe('formatDuration', () => {
  it('0ms → 0s', () => {
    expect(formatDuration(0)).toBe('0s');
  });

  it('30s → 30s', () => {
    expect(formatDuration(30_000)).toBe('30s');
  });

  it('59s → 59s', () => {
    expect(formatDuration(59_000)).toBe('59s');
  });

  it('90s (1m30s) → 1m 30s', () => {
    expect(formatDuration(90_000)).toBe('1m 30s');
  });

  it('4m23s → 4m 23s', () => {
    expect(formatDuration(4 * 60_000 + 23_000)).toBe('4m 23s');
  });

  it('1h30m → 1h 30m', () => {
    expect(formatDuration(90 * 60_000)).toBe('1h 30m');
  });

  it('exactly 60s → 1m 0s', () => {
    expect(formatDuration(60_000)).toBe('1m 0s');
  });

  it('exactly 1h → 1h 0m', () => {
    expect(formatDuration(3600_000)).toBe('1h 0m');
  });
});

// ─── printBanner ─────────────────────────────────────────────────────────────

describe('printBanner', () => {
  it('shows heading and all fields for build mode', () => {
    mockExecSync.mockReturnValue('feature/my-branch\n');
    const agentConfig: AgentConfig = { cli: 'claude', args: ['--print'], timeout: 1800 };
    const runConfig = makeRunConfig({ loop: { 'max-iterations': 10, 'stall-threshold': 3, 'iteration-timeout': 900 } });

    printBanner('build', agentConfig, runConfig);

    expect(mockHeading).toHaveBeenCalledWith('ralph run');
    expect(mockInfo).toHaveBeenCalledWith('Phase: build');
    expect(mockInfo).toHaveBeenCalledWith('Agent: claude (print)');
    expect(mockInfo).toHaveBeenCalledWith('Branch: feature/my-branch');
    expect(mockInfo).toHaveBeenCalledWith('Max iterations: 10');
    expect(mockInfo).toHaveBeenCalledWith('Stall threshold: 3');
  });

  it('shows "unlimited" when max-iterations is 0', () => {
    mockExecSync.mockReturnValue('main\n');
    const agentConfig: AgentConfig = { cli: 'codex', args: [], timeout: 600 };
    const runConfig = makeRunConfig({ loop: { 'max-iterations': 0, 'stall-threshold': 5, 'iteration-timeout': 900 } });

    printBanner('plan', agentConfig, runConfig);

    expect(mockInfo).toHaveBeenCalledWith('Max iterations: unlimited');
    expect(mockInfo).toHaveBeenCalledWith('Phase: plan');
    expect(mockInfo).toHaveBeenCalledWith('Agent: codex (print)');
  });

  it('shows "unknown" when git command fails', () => {
    mockExecSync.mockImplementation(() => { throw new Error('not a git repo'); });
    const agentConfig: AgentConfig = { cli: 'claude', args: [], timeout: 600 };
    const runConfig = makeRunConfig();

    printBanner('build', agentConfig, runConfig);

    expect(mockInfo).toHaveBeenCalledWith('Branch: unknown');
  });
});

// ─── printIterationHeader ─────────────────────────────────────────────────────

describe('printIterationHeader', () => {
  it('outputs iteration number in heading', () => {
    printIterationHeader(3);
    expect(mockHeading).toHaveBeenCalledWith('── Iteration 3 ──');
  });
});

// ─── printIterationSummary ────────────────────────────────────────────────────

describe('printIterationSummary', () => {
  it('shows duration and exit code', () => {
    printIterationSummary(1, { exitCode: 0, durationMs: 30_000 }, null, null);

    expect(mockInfo).toHaveBeenCalledWith('Duration: 30s');
    expect(mockInfo).toHaveBeenCalledWith('Exit code: 0');
  });

  it('shows task when provided', () => {
    printIterationSummary(1, { exitCode: 0, durationMs: 5000 }, null, 'Task 3 — Config Validation');

    expect(mockInfo).toHaveBeenCalledWith('Task: Task 3 — Config Validation');
  });

  it('shows commit hash when provided', () => {
    printIterationSummary(1, { exitCode: 0, durationMs: 5000 }, 'abc1234', null);

    expect(mockInfo).toHaveBeenCalledWith('Commit: abc1234');
  });

  it('omits task and commit when null', () => {
    printIterationSummary(1, { exitCode: 0, durationMs: 5000 }, null, null);

    const calls = mockInfo.mock.calls.map(c => c[0]);
    expect(calls.some(c => c.startsWith('Task:'))).toBe(false);
    expect(calls.some(c => c.startsWith('Commit:'))).toBe(false);
  });
});

// ─── printFinalSummary ────────────────────────────────────────────────────────

describe('printFinalSummary', () => {
  it('shows run complete heading and all fields', () => {
    const cp = baseCheckpoint({
      history: [
        { iteration: 1, durationMs: 30_000, exitCode: 0, commit: 'aaa1111' },
        { iteration: 2, durationMs: 60_000, exitCode: 0, commit: 'bbb2222' },
      ],
    });

    printFinalSummary('max iterations reached', cp);

    expect(mockHeading).toHaveBeenCalledWith('Run complete');
    expect(mockInfo).toHaveBeenCalledWith('Total iterations: 2');
    expect(mockInfo).toHaveBeenCalledWith('Duration: 1m 30s');
    expect(mockInfo).toHaveBeenCalledWith('Commits: aaa1111..bbb2222');
    expect(mockInfo).toHaveBeenCalledWith('Stop reason: max iterations reached');
  });

  it('shows single Commit when only one commit in history', () => {
    const cp = baseCheckpoint({
      history: [
        { iteration: 1, durationMs: 5000, exitCode: 0, commit: 'abc1234' },
      ],
    });

    printFinalSummary('stall detected', cp);

    expect(mockInfo).toHaveBeenCalledWith('Commit: abc1234');
  });

  it('omits commits line when no commits in history', () => {
    const cp = baseCheckpoint({
      history: [
        { iteration: 1, durationMs: 5000, exitCode: 1, commit: null },
      ],
    });

    printFinalSummary('error', cp);

    const calls = mockInfo.mock.calls.map(c => c[0]);
    expect(calls.some(c => c.startsWith('Commit'))).toBe(false);
  });

  it('shows 0s duration for empty history', () => {
    const cp = baseCheckpoint({ history: [] });

    printFinalSummary('manual stop', cp);

    expect(mockInfo).toHaveBeenCalledWith('Duration: 0s');
    expect(mockInfo).toHaveBeenCalledWith('Total iterations: 0');
  });
});
