import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SpawnSyncReturns } from 'node:child_process';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));

// ─── Imports after mocks ─────────────────────────────────────────────────────

import { spawnSync } from 'node:child_process';
import { synthesizeDefaultStages, executeStages } from './stages.js';
import type { ValidationStage } from '../../config/schema.js';

const mockSpawnSync = vi.mocked(spawnSync);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSpawnResult(
  status: number | null,
  stdout = '',
  stderr = '',
  signal: NodeJS.Signals | null = null,
): SpawnSyncReturns<string> {
  return {
    status,
    stdout,
    stderr,
    signal,
    pid: 12345,
    output: [null, stdout, stderr],
  };
}

function makeStage(
  name: string,
  command: string,
  required = true,
  options: Partial<ValidationStage> = {},
): ValidationStage {
  return { name, command, required, ...options };
}

// ─── synthesizeDefaultStages ─────────────────────────────────────────────────

describe('synthesizeDefaultStages', () => {
  it('both commands present → 2 stages with correct name/required/timeout', () => {
    const stages = synthesizeDefaultStages('npm test', 'npx tsc --noEmit');

    expect(stages).toHaveLength(2);
    expect(stages[0]!).toEqual({ name: 'test', command: 'npm test', required: true, timeout: 120 });
    expect(stages[1]!).toEqual({ name: 'typecheck', command: 'npx tsc --noEmit', required: true, timeout: 120 });
  });

  it('testCmd null → 1 stage (typecheck only)', () => {
    const stages = synthesizeDefaultStages(null, 'npx tsc --noEmit');

    expect(stages).toHaveLength(1);
    expect(stages[0]!.name).toBe('typecheck');
  });

  it('typecheckCmd null → 1 stage (test only)', () => {
    const stages = synthesizeDefaultStages('npm test', null);

    expect(stages).toHaveLength(1);
    expect(stages[0]!.name).toBe('test');
  });

  it('both null → 0 stages', () => {
    const stages = synthesizeDefaultStages(null, null);

    expect(stages).toHaveLength(0);
  });

  it('test stage appears first', () => {
    const stages = synthesizeDefaultStages('npm test', 'npx tsc --noEmit');

    expect(stages[0]!.name).toBe('test');
    expect(stages[1]!.name).toBe('typecheck');
  });
});

// ─── executeStages ───────────────────────────────────────────────────────────

describe('executeStages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── empty stages ──────────────────────────────────────────────────────────

  it('empty array → passed: true, no stages, failedStage: null, testOutput: ""', () => {
    const result = executeStages([]);

    expect(result).toEqual({ passed: true, stages: [], failedStage: null, testOutput: '' });
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  // ── all pass ──────────────────────────────────────────────────────────────

  it('all stages pass → passed: true, failedStage: null', () => {
    mockSpawnSync
      .mockReturnValueOnce(makeSpawnResult(0, 'ok'))
      .mockReturnValueOnce(makeSpawnResult(0, 'clean'));

    const result = executeStages([
      makeStage('test', 'npm test'),
      makeStage('typecheck', 'npx tsc --noEmit'),
    ]);

    expect(result.passed).toBe(true);
    expect(result.failedStage).toBeNull();
    expect(result.stages).toHaveLength(2);
    expect(result.stages[0]!.passed).toBe(true);
    expect(result.stages[1]!.passed).toBe(true);
  });

  // ── required stage fails → early termination ─────────────────────────────

  it('required stage fails → early termination, failedStage set, subsequent stages absent', () => {
    mockSpawnSync.mockReturnValueOnce(makeSpawnResult(1, 'FAIL'));

    const result = executeStages([
      makeStage('test', 'npm test', true),
      makeStage('typecheck', 'npx tsc --noEmit', true),
    ]);

    expect(result.passed).toBe(false);
    expect(result.failedStage).toBe('test');
    expect(result.stages).toHaveLength(1);
    expect(mockSpawnSync).toHaveBeenCalledOnce();
  });

  // ── non-required stage fails → pipeline continues ────────────────────────

  it('non-required stage fails → pipeline continues, passed: true', () => {
    mockSpawnSync
      .mockReturnValueOnce(makeSpawnResult(1, 'warn'))
      .mockReturnValueOnce(makeSpawnResult(0, 'clean'));

    const result = executeStages([
      makeStage('lint', 'npm run lint', false),
      makeStage('typecheck', 'npx tsc --noEmit', true),
    ]);

    expect(result.passed).toBe(true);
    expect(result.failedStage).toBeNull();
    expect(result.stages).toHaveLength(2);
    expect(result.stages[0]!.passed).toBe(false);
    expect(result.stages[1]!.passed).toBe(true);
    expect(mockSpawnSync).toHaveBeenCalledTimes(2);
  });

  // ── run-after: predecessor failed → stage skipped ────────────────────────

  it('run-after on failed stage → stage skipped with skipped: true, passed: false', () => {
    mockSpawnSync.mockReturnValueOnce(makeSpawnResult(1, 'unit fail'));

    const result = executeStages([
      makeStage('unit', 'npm test', false),
      makeStage('integration', 'npm run integration', true, { 'run-after': 'unit' }),
    ]);

    expect(result.stages).toHaveLength(2);
    expect(result.stages[1]!.skipped).toBe(true);
    expect(result.stages[1]!.passed).toBe(false);
    expect(result.stages[1]!.name).toBe('integration');
    expect(mockSpawnSync).toHaveBeenCalledOnce();
  });

  // ── run-after: transitive skip ────────────────────────────────────────────

  it('run-after on skipped stage → also skipped (transitive)', () => {
    mockSpawnSync.mockReturnValueOnce(makeSpawnResult(1, 'unit fail'));

    const result = executeStages([
      makeStage('unit', 'npm test', false),
      makeStage('integration', 'npm run integration', false, { 'run-after': 'unit' }),
      makeStage('e2e', 'npm run e2e', false, { 'run-after': 'integration' }),
    ]);

    expect(result.stages).toHaveLength(3);
    expect(result.stages[1]!.skipped).toBe(true);
    expect(result.stages[2]!.skipped).toBe(true);
    expect(mockSpawnSync).toHaveBeenCalledOnce();
  });

  // ── timeout ───────────────────────────────────────────────────────────────

  it('stage timeout → passed: false, exitCode: -1, output contains "timed out after"', () => {
    mockSpawnSync.mockReturnValueOnce(makeSpawnResult(null, '', '', 'SIGTERM'));

    const result = executeStages([
      makeStage('test', 'npm test', true, { timeout: 30 }),
    ]);

    expect(result.passed).toBe(false);
    expect(result.stages[0]!.exitCode).toBe(-1);
    expect(result.stages[0]!.output).toContain('timed out after');
    expect(result.stages[0]!.output).toContain('30s');
  });

  // ── testOutput sourcing ───────────────────────────────────────────────────

  it('testOutput sourced from "test" stage first', () => {
    mockSpawnSync
      .mockReturnValueOnce(makeSpawnResult(0, 'test output'))
      .mockReturnValueOnce(makeSpawnResult(0, 'typecheck output'));

    const result = executeStages([
      makeStage('test', 'npm test'),
      makeStage('typecheck', 'npx tsc --noEmit'),
    ]);

    expect(result.testOutput).toBe('test output');
  });

  it('testOutput sourced from "unit" stage when no "test" stage', () => {
    mockSpawnSync
      .mockReturnValueOnce(makeSpawnResult(0, 'typecheck output'))
      .mockReturnValueOnce(makeSpawnResult(0, 'unit output'));

    const result = executeStages([
      makeStage('typecheck', 'npx tsc --noEmit'),
      makeStage('unit', 'npm run unit'),
    ]);

    expect(result.testOutput).toBe('unit output');
  });

  it('testOutput falls back to first stage output when no "test" or "unit" stage', () => {
    mockSpawnSync
      .mockReturnValueOnce(makeSpawnResult(0, 'lint output'))
      .mockReturnValueOnce(makeSpawnResult(0, 'typecheck output'));

    const result = executeStages([
      makeStage('lint', 'npm run lint'),
      makeStage('typecheck', 'npx tsc --noEmit'),
    ]);

    expect(result.testOutput).toBe('lint output');
  });

  // ── spawnSync call args ───────────────────────────────────────────────────

  it('executes via sh -c with correct timeout and encoding', () => {
    mockSpawnSync.mockReturnValueOnce(makeSpawnResult(0, ''));

    executeStages([makeStage('test', 'npm test', true, { timeout: 60 })]);

    expect(mockSpawnSync).toHaveBeenCalledWith(
      'sh',
      ['-c', 'npm test'],
      expect.objectContaining({ timeout: 60_000, encoding: 'utf-8' }),
    );
  });

  // ── stdout+stderr combined ────────────────────────────────────────────────

  it('captures stdout and stderr combined in output', () => {
    mockSpawnSync.mockReturnValueOnce(makeSpawnResult(0, 'stdout text', 'stderr text'));

    const result = executeStages([makeStage('test', 'npm test')]);

    expect(result.stages[0]!.output).toBe('stdout textstderr text');
  });
});
