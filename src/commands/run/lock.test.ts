import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdirSync, writeFileSync, existsSync, rmSync, mkdtempSync, unlinkSync, readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { acquireLock, releaseLock, isLockHeld } from './lock.js';

// ─── Test setup ──────────────────────────────────────────────────────────────

let tmpDir: string;
let origCwd: string;

beforeEach(() => {
  origCwd = process.cwd();
  tmpDir = mkdtempSync(join(tmpdir(), 'ralph-lock-'));
  mkdirSync(join(tmpDir, '.ralph'), { recursive: true });
  process.chdir(tmpDir);
});

afterEach(() => {
  // Release lock if still held so the file gets cleaned up
  try { releaseLock(); } catch { /* ignore */ }
  process.chdir(origCwd);
  rmSync(tmpDir, { recursive: true, force: true });
});

// ─── acquireLock ─────────────────────────────────────────────────────────────

describe('acquireLock', () => {
  it('creates lock file with current PID on success', () => {
    acquireLock();
    expect(existsSync('.ralph/run.lock')).toBe(true);
    const content = JSON.parse(readFileSync('.ralph/run.lock', 'utf-8')) as { pid: number };
    expect(content.pid).toBe(process.pid);
  });

  it('EEXIST + dead PID: stale lock is removed and retried', () => {
    // Write a lock file with a dead PID (very high number that should not exist)
    const deadPid = 999_999;
    writeFileSync(
      '.ralph/run.lock',
      JSON.stringify({ pid: deadPid, startedAt: new Date().toISOString() }) + '\n',
    );

    // acquireLock should succeed by removing the stale lock and retrying
    expect(() => acquireLock()).not.toThrow();

    expect(existsSync('.ralph/run.lock')).toBe(true);
    const content = JSON.parse(readFileSync('.ralph/run.lock', 'utf-8')) as { pid: number };
    expect(content.pid).toBe(process.pid);
  });

  it('EEXIST + live PID: throws with informative message', () => {
    // Write a lock file with our own PID — our process is alive
    writeFileSync(
      '.ralph/run.lock',
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + '\n',
    );

    expect(() => acquireLock()).toThrow(/Another ralph run is active/);
  });

  it('--force removes existing lock and acquires fresh one', () => {
    // Pre-existing lock with our own PID (would normally throw without --force)
    writeFileSync(
      '.ralph/run.lock',
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + '\n',
    );

    expect(() => acquireLock(true)).not.toThrow();
    expect(existsSync('.ralph/run.lock')).toBe(true);
    const content = JSON.parse(readFileSync('.ralph/run.lock', 'utf-8')) as { pid: number };
    expect(content.pid).toBe(process.pid);
  });

  it('creates .ralph directory if missing', () => {
    // Remove the .ralph dir we created in beforeEach
    rmSync(join(tmpDir, '.ralph'), { recursive: true, force: true });
    expect(existsSync('.ralph')).toBe(false);

    acquireLock();
    expect(existsSync('.ralph/run.lock')).toBe(true);
  });
});

// ─── releaseLock ─────────────────────────────────────────────────────────────

describe('releaseLock', () => {
  it('removes lock file when held by this process', () => {
    acquireLock();
    expect(existsSync('.ralph/run.lock')).toBe(true);
    releaseLock();
    expect(existsSync('.ralph/run.lock')).toBe(false);
  });

  it('is idempotent — multiple calls do not throw', () => {
    acquireLock();
    releaseLock();
    expect(() => releaseLock()).not.toThrow();
    expect(() => releaseLock()).not.toThrow();
  });

  it('does not remove lock owned by a different PID', () => {
    // Write a lock file with a different PID so releaseLock() should leave it
    const deadPid = 999_998;
    writeFileSync(
      '.ralph/run.lock',
      JSON.stringify({ pid: deadPid, startedAt: new Date().toISOString() }) + '\n',
    );
    releaseLock();
    // Lock file should still exist (different PID, not ours)
    expect(existsSync('.ralph/run.lock')).toBe(true);
    // Clean up manually
    unlinkSync('.ralph/run.lock');
  });
});

// ─── isLockHeld ──────────────────────────────────────────────────────────────

describe('isLockHeld', () => {
  it('returns false when no lock file exists', () => {
    expect(isLockHeld()).toBe(false);
  });

  it('returns true when lock is held by a live process', () => {
    acquireLock();
    expect(isLockHeld()).toBe(true);
    releaseLock();
  });

  it('returns false after lock is released', () => {
    acquireLock();
    releaseLock();
    expect(isLockHeld()).toBe(false);
  });

  it('returns false when lock file contains a dead PID', () => {
    writeFileSync(
      '.ralph/run.lock',
      JSON.stringify({ pid: 999_997, startedAt: new Date().toISOString() }) + '\n',
    );
    expect(isLockHeld()).toBe(false);
    // Clean up manually
    unlinkSync('.ralph/run.lock');
  });
});
