import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';
const mockSpawn = vi.mocked(spawn);

import { discoverScorer, runScorer } from './scorer.js';

function makeProc() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = new EventEmitter();
  proc.kill = vi.fn();
  return proc;
}

// ─── discoverScorer ───────────────────────────────────────────────────────────

describe('discoverScorer', () => {
  let tmpDir: string;
  let origCwd: string;

  beforeEach(() => {
    origCwd = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), 'ralph-scorer-test-'));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns script path when config.script is set and file exists', () => {
    const scriptPath = join(tmpDir, 'custom-score.sh');
    writeFileSync(scriptPath, '#!/bin/sh\necho 0.9');
    const config = {
      script: scriptPath,
      'regression-threshold': 0.02,
      'cumulative-threshold': 0.1,
      'auto-revert': true,
      'default-weights': { tests: 0.6, coverage: 0.4 },
    };
    expect(discoverScorer(config)).toBe(scriptPath);
  });

  it('returns null when config is undefined and no script files exist', () => {
    expect(discoverScorer(undefined)).toBeNull();
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

  it('returns parsed ScoreResult when script succeeds with valid output', async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const promise = runScorer('score.sh', 1, 'abc1234');
    proc.stdout.emit('data', Buffer.from('0.75\ttest_rate=0.9\n'));
    proc.emit('close', 0);

    const result = await promise;
    expect(result.score).toBe(0.75);
    expect(result.source).toBe('script');
    expect(result.scriptPath).toBe('score.sh');
    expect(result.metrics['test_rate']).toBe('0.9');
  });

  it('returns null score when script exits with non-zero code', async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const promise = runScorer('score.sh', 1, 'abc1234');
    proc.emit('close', 1);

    const result = await promise;
    expect(result.score).toBeNull();
    expect(result.error).toMatch(/exit 1/);
  });

  it('returns null score when script outputs invalid (non-numeric) value', async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const promise = runScorer('score.sh', 1, 'abc1234');
    proc.stdout.emit('data', Buffer.from('not-a-number\n'));
    proc.emit('close', 0);

    const result = await promise;
    expect(result.score).toBeNull();
    expect(result.error).toMatch(/invalid score/);
  });

  it('returns null score and kills process after 60s timeout', async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const promise = runScorer('score.sh', 1, 'abc1234');
    vi.advanceTimersByTime(60_001);

    const result = await promise;
    expect(result.score).toBeNull();
    expect(result.error).toBe('timeout');
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
  });
});
