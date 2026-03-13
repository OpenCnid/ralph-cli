import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SpawnSyncReturns } from 'node:child_process';
import type { RunConfig } from '../../config/schema.js';
import { DEFAULT_ADVERSARIAL } from '../../config/defaults.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));

// ─── Imports after mocks ─────────────────────────────────────────────────────

import { spawnSync } from 'node:child_process';
import { runValidation } from './validation.js';

const mockSpawnSync = vi.mocked(spawnSync);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRunConfig(
  testCommand: string | null = null,
  typecheckCommand: string | null = null,
): RunConfig {
  return {
    agent: { cli: 'claude', args: ['--print'], timeout: 1800 },
    'plan-agent': null,
    'build-agent': null,
    prompts: { plan: null, build: null },
    loop: { 'max-iterations': 0, 'stall-threshold': 3, 'iteration-timeout': 900 },
    validation: { 'test-command': testCommand, 'typecheck-command': typecheckCommand },
    git: { 'auto-commit': true, 'auto-push': false, 'commit-prefix': 'ralph:', branch: null },
    adversarial: DEFAULT_ADVERSARIAL,
  };
}

function makeSpawnResult(
  status: number | null,
  stdout = '',
  signal: NodeJS.Signals | null = null,
): SpawnSyncReturns<string> {
  return {
    status,
    stdout,
    stderr: '',
    signal,
    pid: 12345,
    output: [null, stdout, ''],
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('runValidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── both null → pass immediately ──────────────────────────────────────────

  it('both commands null: skips spawnSync and returns passed=true', () => {
    const result = runValidation(makeRunConfig(null, null));

    expect(mockSpawnSync).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ passed: true, testOutput: '' }));
  });

  // ── test command stdout captured ──────────────────────────────────────────

  it('test command stdout is captured in testOutput', () => {
    mockSpawnSync.mockReturnValueOnce(makeSpawnResult(0, 'Tests: 42 passed\n'));

    const result = runValidation(makeRunConfig('npm test'));

    expect(result.passed).toBe(true);
    expect(result.testOutput).toBe('Tests: 42 passed\n');
  });

  it('test command stdout is empty string when spawnSync returns null stdout', () => {
    mockSpawnSync.mockReturnValueOnce(makeSpawnResult(0, ''));

    const result = runValidation(makeRunConfig('npm test'));

    expect(result.testOutput).toBe('');
    expect(result.passed).toBe(true);
  });

  // ── non-zero test command → fail ──────────────────────────────────────────

  it('test command non-zero exit: returns passed=false with testOutput', () => {
    mockSpawnSync.mockReturnValueOnce(makeSpawnResult(1, 'FAIL: 3 tests failed\n'));

    const result = runValidation(makeRunConfig('npm test'));

    expect(result.passed).toBe(false);
    expect(result.testOutput).toBe('FAIL: 3 tests failed\n');
  });

  // ── typecheck non-zero → fail ─────────────────────────────────────────────

  it('typecheck command non-zero exit: returns passed=false', () => {
    mockSpawnSync
      .mockReturnValueOnce(makeSpawnResult(0, 'all tests pass'))   // test-command passes
      .mockReturnValueOnce(makeSpawnResult(1, ''));                 // typecheck fails

    const result = runValidation(makeRunConfig('npm test', 'npx tsc --noEmit'));

    expect(result.passed).toBe(false);
    // testOutput still contains test output
    expect(result.testOutput).toBe('all tests pass');
  });

  it('both commands pass: returns passed=true', () => {
    mockSpawnSync
      .mockReturnValueOnce(makeSpawnResult(0, 'pass'))
      .mockReturnValueOnce(makeSpawnResult(0, ''));

    const result = runValidation(makeRunConfig('npm test', 'npx tsc --noEmit'));

    expect(result.passed).toBe(true);
    expect(result.testOutput).toBe('pass');
  });

  // ── only typecheck (no test command) ─────────────────────────────────────

  it('typecheck-only config: runs only typecheck, testOutput is empty', () => {
    mockSpawnSync.mockReturnValueOnce(makeSpawnResult(0, ''));

    const result = runValidation(makeRunConfig(null, 'npx tsc --noEmit'));

    expect(mockSpawnSync).toHaveBeenCalledOnce();
    expect(result.passed).toBe(true);
    expect(result.testOutput).toBe('');
  });

  // ── 120s timeout ─────────────────────────────────────────────────────────

  it('passes 120s timeout to spawnSync', () => {
    mockSpawnSync.mockReturnValue(makeSpawnResult(0, ''));

    runValidation(makeRunConfig('npm test', 'npx tsc --noEmit'));

    for (const call of mockSpawnSync.mock.calls) {
      const opts = call[2] as { timeout?: number } | undefined;
      expect(opts?.timeout).toBe(120_000);
    }
  });

  it('timeout (signal set): returns passed=false', () => {
    mockSpawnSync.mockReturnValueOnce(makeSpawnResult(null, '', 'SIGKILL'));

    const result = runValidation(makeRunConfig('npm test'));

    expect(result.passed).toBe(false);
  });

  it('runs commands with sh -c', () => {
    mockSpawnSync.mockReturnValue(makeSpawnResult(0, ''));

    runValidation(makeRunConfig('npm test', 'npx tsc'));

    expect(mockSpawnSync).toHaveBeenNthCalledWith(
      1,
      'sh',
      ['-c', 'npm test'],
      expect.objectContaining({ encoding: 'utf-8' }),
    );
    expect(mockSpawnSync).toHaveBeenNthCalledWith(
      2,
      'sh',
      ['-c', 'npx tsc'],
      expect.objectContaining({ encoding: 'utf-8' }),
    );
  });
});
