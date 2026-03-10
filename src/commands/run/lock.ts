import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LOCK_PATH = join('.ralph', 'run.lock');
let registered = false;

function ensureRalphDir(): void {
  if (!existsSync('.ralph')) {
    mkdirSync('.ralph', { recursive: true });
  }
}

function readLockPid(): { pid: number; startedAt: string } | null {
  try {
    const content = readFileSync(LOCK_PATH, 'utf8');
    const data = JSON.parse(content) as { pid: number; startedAt: string };
    if (typeof data.pid === 'number' && typeof data.startedAt === 'string') {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function writeLock(): void {
  const content = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + '\n';
  writeFileSync(LOCK_PATH, content, { flag: 'wx' });
}

function registerExitHandler(): void {
  if (!registered) {
    process.on('exit', releaseLock);
    registered = true;
  }
}

export function acquireLock(force = false): void {
  ensureRalphDir();

  if (force && existsSync(LOCK_PATH)) {
    unlinkSync(LOCK_PATH);
  }

  try {
    writeLock();
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code !== 'EEXIST') throw err;

    // Lock file exists — check if the owning process is still alive
    const lock = readLockPid();
    if (lock !== null && isProcessAlive(lock.pid)) {
      throw new Error(
        `Another ralph run is active (PID ${lock.pid}, started ${lock.startedAt}). Use --force to override.`
      );
    }

    // Stale lock — delete and retry
    if (existsSync(LOCK_PATH)) {
      unlinkSync(LOCK_PATH);
    }
    writeLock();
  }

  registerExitHandler();
}

export function releaseLock(): void {
  if (existsSync(LOCK_PATH)) {
    try {
      const lock = readLockPid();
      if (lock === null || lock.pid === process.pid) {
        unlinkSync(LOCK_PATH);
      }
    } catch {
      // ignore errors during cleanup
    }
  }
}

export function isLockHeld(): boolean {
  if (!existsSync(LOCK_PATH)) return false;
  const lock = readLockPid();
  if (lock === null) return false;
  return isProcessAlive(lock.pid);
}
