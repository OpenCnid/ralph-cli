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

  it('throws when config.script is set but the file does not exist', () => {
    const config = {
      script: join(tmpDir, 'nonexistent-score.sh'),
      'regression-threshold': 0.02,
      'cumulative-threshold': 0.1,
      'auto-revert': false,
      'default-weights': { tests: 0.6, coverage: 0.4 },
    };
    expect(() => discoverScorer(config)).toThrow(/Scoring script not found/);
  });

  it('auto-discovers score.sh in CWD when config is undefined', () => {
    writeFileSync(join(tmpDir, 'score.sh'), '#!/bin/sh\necho 0.5');
    expect(discoverScorer(undefined)).toBe('score.sh');
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

  it('returns null score when script outputs score out of range (>1.0)', async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const promise = runScorer('score.sh', 1, 'abc1234');
    proc.stdout.emit('data', Buffer.from('1.5\n'));
    proc.emit('close', 0);

    const result = await promise;
    expect(result.score).toBeNull();
    expect(result.error).toMatch(/out of range/);
  });

  it('returns null score when script exits 0 with empty stdout', async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const promise = runScorer('score.sh', 1, 'abc1234');
    // No data emitted — process closes cleanly with empty output
    proc.emit('close', 0);

    const result = await promise;
    expect(result.score).toBeNull();
    expect(result.error).toBe('empty output');
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

  it('returns source=default when EACCES comes from proc error event (not spawn throw)', async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const promise = runScorer('score.sh', 1, 'abc1234');
    const eaccesErr = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    proc.emit('error', eaccesErr);

    const result = await promise;
    expect(result.score).toBeNull();
    expect(result.source).toBe('default');
    expect(result.error).toBe('EACCES');
  });

  it('returns valid score of exactly 0.0 (boundary: minimum valid score)', async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const promise = runScorer('score.sh', 1, 'abc1234');
    proc.stdout.emit('data', Buffer.from('0.0\n'));
    proc.emit('close', 0);

    const result = await promise;
    expect(result.score).toBe(0.0);
    expect(result.error).toBeUndefined();
    expect(result.source).toBe('script');
  });

  it('auto-discovers score.ts in CWD when score.sh does not exist', () => {
    // discoverScorer() checks score.sh first, then score.ts
    // This tests the fallback to score.ts discovery
    const { mkdtempSync, writeFileSync: wfs, rmSync: rms } = require('node:fs');
    const { join: pjoin } = require('node:path');
    const { tmpdir: osTmpdir } = require('node:os');
    const tDir = mkdtempSync(pjoin(osTmpdir(), 'ralph-scorer-ts-'));
    const origCwd2 = process.cwd();
    try {
      process.chdir(tDir);
      wfs(pjoin(tDir, 'score.ts'), 'export {}');
      expect(discoverScorer(undefined)).toBe('score.ts');
    } finally {
      process.chdir(origCwd2);
      rms(tDir, { recursive: true, force: true });
    }
  });
});
