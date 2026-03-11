import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { AgentConfig } from '../../config/schema.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('./agent.js', () => ({
  spawnAgent: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

// ─── Imports after mocks ─────────────────────────────────────────────────────

import { spawn } from 'node:child_process';
import { spawnAgent } from './agent.js';
import { spawnAgentWithTimeout } from './timeout.js';

const mockSpawn = vi.mocked(spawn);
const mockSpawnAgent = vi.mocked(spawnAgent);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeAgentConfig(timeout = 1800): AgentConfig {
  return { cli: 'claude', args: ['--print'], timeout };
}

type FakeProc = EventEmitter & {
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  kill: ReturnType<typeof vi.fn>;
  stdout: null;
};

function makeProc(): FakeProc {
  const proc = new EventEmitter() as FakeProc;
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  proc.kill = vi.fn();
  proc.stdout = null;
  return proc;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('spawnAgentWithTimeout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── timeout=0 passthrough ──────────────────────────────────────────────────

  it('timeout=0: passes through to spawnAgent without wrapping', async () => {
    const config = makeAgentConfig();
    mockSpawnAgent.mockResolvedValue({ exitCode: 0, durationMs: 100 });

    const result = await spawnAgentWithTimeout(config, 'build me a feature', 0);

    expect(mockSpawnAgent).toHaveBeenCalledWith(config, 'build me a feature', undefined);
    expect(result).toEqual({ exitCode: 0, durationMs: 100 });
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('timeout=0 with options: forwards options to spawnAgent', async () => {
    const config = makeAgentConfig();
    mockSpawnAgent.mockResolvedValue({ exitCode: 0, durationMs: 200 });

    await spawnAgentWithTimeout(config, 'prompt', 0, { verbose: true });

    expect(mockSpawnAgent).toHaveBeenCalledWith(config, 'prompt', { verbose: true });
  });

  // ── SIGTERM at expiry ──────────────────────────────────────────────────────

  it('sends SIGTERM when iteration timeout expires', async () => {
    vi.useFakeTimers();
    const config = makeAgentConfig();
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const iterationTimeout = 10; // seconds
    const promise = spawnAgentWithTimeout(config, 'prompt', iterationTimeout);

    // Advance past the outer timeout
    vi.advanceTimersByTime(iterationTimeout * 1000 + 1);

    // Emit close so the promise can resolve
    proc.emit('close', null);

    const result = await promise;

    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(1);
  });

  // ── SIGKILL after 10s ─────────────────────────────────────────────────────

  it('sends SIGKILL 10 seconds after SIGTERM if process does not exit', async () => {
    vi.useFakeTimers();
    const config = makeAgentConfig();
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const iterationTimeout = 10;
    const promise = spawnAgentWithTimeout(config, 'prompt', iterationTimeout);

    // Trigger SIGTERM
    vi.advanceTimersByTime(iterationTimeout * 1000 + 1);
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');

    // Advance another 10s to trigger SIGKILL
    vi.advanceTimersByTime(10_000);
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');

    // Resolve the promise
    proc.emit('close', null);
    const result = await promise;

    expect(result.timedOut).toBe(true);
  });

  // ── timedOut field on result ───────────────────────────────────────────────

  it('result has timedOut: true when iteration timeout fires', async () => {
    vi.useFakeTimers();
    const config = makeAgentConfig();
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const promise = spawnAgentWithTimeout(config, 'prompt', 5);

    vi.advanceTimersByTime(5001);
    proc.emit('close', null);

    const result = await promise;
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(1);
  });

  it('result does NOT have timedOut when process exits before timeout', async () => {
    vi.useFakeTimers();
    const config = makeAgentConfig();
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const promise = spawnAgentWithTimeout(config, 'prompt', 30);

    // Process exits before timeout
    proc.emit('close', 0);

    const result = await promise;
    expect(result.timedOut).toBeUndefined();
    expect(result.exitCode).toBe(0);
  });

  // ── inner timeout bump ─────────────────────────────────────────────────────

  it('bumps agent config timeout to max(iterationTimeout+30, config.timeout)', async () => {
    vi.useFakeTimers();
    const config = makeAgentConfig(20); // timeout=20 < iterationTimeout+30=35
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const promise = spawnAgentWithTimeout(config, 'prompt', 5);

    // Process exits immediately
    proc.emit('close', 0);
    await promise;

    // spawn should have been called (not spawnAgent)
    expect(mockSpawn).toHaveBeenCalled();
    // spawnAgent should NOT have been called (timeout>0 path uses spawn directly)
    expect(mockSpawnAgent).not.toHaveBeenCalled();
  });

  // ── spawn error handling ───────────────────────────────────────────────────

  it('returns error result when spawn throws ENOENT', async () => {
    vi.useFakeTimers();
    const config = makeAgentConfig();
    const enoent = Object.assign(new Error('spawn error'), { code: 'ENOENT' });
    mockSpawn.mockImplementation(() => { throw enoent; });

    const result = await spawnAgentWithTimeout(config, 'prompt', 10);

    expect(result.exitCode).toBe(1);
    expect(result.error).toMatch(/not found/);
  });
});
