import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { spawnAgent, resolveAgent, injectModel, AGENT_PRESETS } from './agent.js';
import type { AgentConfig, RunConfig } from '../../config/schema.js';
import { DEFAULT_ADVERSARIAL } from '../../config/defaults.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'node:child_process';
const mockSpawn = vi.mocked(spawn);

function makeProc() {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  proc.kill = vi.fn();
  return proc;
}

function makeRunConfig(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    agent: { cli: 'claude', args: ['--print', '--model', 'sonnet'], timeout: 1800 },
    'plan-agent': null,
    'build-agent': null,
    prompts: { plan: null, build: null },
    loop: { 'max-iterations': 0, 'stall-threshold': 3, 'iteration-timeout': 900 },
    validation: { 'test-command': null, 'typecheck-command': null },
    git: { 'auto-commit': true, 'auto-push': false, 'commit-prefix': 'ralph:', branch: null },
    adversarial: DEFAULT_ADVERSARIAL,
    ...overrides,
  };
}

// ─── spawnAgent ─────────────────────────────────────────────────────────────

describe('spawnAgent', () => {
  beforeEach(() => {
    mockSpawn.mockClear();
  });

  it('successful spawn returns exit code and duration', async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const config: AgentConfig = { cli: 'claude', args: ['--print'], timeout: 30 };
    const promise = spawnAgent(config, 'build me a feature');

    proc.emit('close', 0);
    const result = await promise;

    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();
  });

  it('non-zero exit code is preserved', async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const config: AgentConfig = { cli: 'claude', args: [], timeout: 30 };
    const promise = spawnAgent(config, 'prompt');

    proc.emit('close', 2);
    const result = await promise;

    expect(result.exitCode).toBe(2);
    expect(result.error).toBeUndefined();
  });

  it('ENOENT error emits error result with not found message', async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const config: AgentConfig = { cli: 'nonexistent-cli', args: [], timeout: 30 };
    const promise = spawnAgent(config, 'prompt');

    const err = Object.assign(new Error('spawn nonexistent-cli ENOENT'), { code: 'ENOENT' });
    proc.emit('error', err);

    const result = await promise;
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain('"nonexistent-cli"');
    expect(result.error).toContain('not found');
  });

  it('EACCES error emits error result with permission message', async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const config: AgentConfig = { cli: 'restricted', args: [], timeout: 30 };
    const promise = spawnAgent(config, 'prompt');

    const err = Object.assign(new Error('spawn EACCES'), { code: 'EACCES' });
    proc.emit('error', err);

    const result = await promise;
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain('"restricted"');
    expect(result.error).toContain('not executable');
  });

  it('ENOMEM error emits error result with memory message', async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const config: AgentConfig = { cli: 'claude', args: [], timeout: 30 };
    const promise = spawnAgent(config, 'prompt');

    const err = Object.assign(new Error('spawn ENOMEM'), { code: 'ENOMEM' });
    proc.emit('error', err);

    const result = await promise;
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain('memory');
  });

  it('stdin piping sends prompt to process', async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const config: AgentConfig = { cli: 'claude', args: [], timeout: 30 };
    const prompt = 'Please implement feature X with full test coverage';
    const promise = spawnAgent(config, prompt);

    proc.emit('close', 0);
    await promise;

    expect(proc.stdin.write).toHaveBeenCalledWith(prompt);
    expect(proc.stdin.end).toHaveBeenCalled();
  });

  it('non-verbose mode uses ignore for stdout/stderr', async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const config: AgentConfig = { cli: 'claude', args: [], timeout: 30 };
    const promise = spawnAgent(config, 'prompt', { verbose: false });

    proc.emit('close', 0);
    await promise;

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      [],
      expect.objectContaining({ stdio: ['pipe', 'ignore', 'ignore'] }),
    );
  });

  it('verbose mode uses inherit for stdout/stderr', async () => {
    const proc = makeProc();
    mockSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const config: AgentConfig = { cli: 'claude', args: [], timeout: 30 };
    const promise = spawnAgent(config, 'prompt', { verbose: true });

    proc.emit('close', 0);
    await promise;

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      [],
      expect.objectContaining({ stdio: ['pipe', 'inherit', 'inherit'] }),
    );
  });

  it('timeout kills process and returns timeout error', async () => {
    vi.useFakeTimers();

    const proc = makeProc();
    mockSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const config: AgentConfig = { cli: 'claude', args: [], timeout: 5 };
    const promise = spawnAgent(config, 'prompt');

    // Advance timers to fire the abort controller
    vi.advanceTimersByTime(5000);

    // Simulate process exit after receiving SIGTERM
    proc.emit('close', null);

    vi.useRealTimers();
    const result = await promise;

    expect(result.exitCode).toBe(1);
    expect(result.error).toContain('timed out');
    expect(result.error).toContain('5s');
  });

  it('ABORT_ERR on error event is ignored (handled by close)', async () => {
    vi.useFakeTimers();

    const proc = makeProc();
    mockSpawn.mockReturnValue(proc as unknown as ReturnType<typeof spawn>);

    const config: AgentConfig = { cli: 'claude', args: [], timeout: 2 };
    const promise = spawnAgent(config, 'prompt');

    vi.advanceTimersByTime(2000);

    // Real Node.js emits ABORT_ERR error before close; close resolves the promise
    const abortErr = Object.assign(new Error('The operation was aborted'), { code: 'ABORT_ERR' });
    proc.emit('error', abortErr);
    proc.emit('close', null);

    vi.useRealTimers();
    const result = await promise;

    expect(result.exitCode).toBe(1);
    expect(result.error).toContain('timed out');
  });

  it('spawn failure (synchronous throw) returns error result', async () => {
    const err = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
    mockSpawn.mockImplementation(() => { throw err; });

    const config: AgentConfig = { cli: 'bad-cli', args: [], timeout: 30 };
    const result = await spawnAgent(config, 'prompt');

    expect(result.exitCode).toBe(1);
    expect(result.error).toContain('"bad-cli"');
  });
});

// ─── resolveAgent ────────────────────────────────────────────────────────────

describe('resolveAgent', () => {
  it('tier 3: uses default agent when no overrides', () => {
    const runConfig = makeRunConfig({
      agent: { cli: 'claude', args: ['--print'], timeout: 600 },
    });

    const result = resolveAgent('build', runConfig);

    expect(result.cli).toBe('claude');
    expect(result.args).toEqual(['--print']);
    expect(result.timeout).toBe(600);
  });

  it('tier 2: phase-specific plan-agent overrides default for plan mode', () => {
    const runConfig = makeRunConfig({
      agent: { cli: 'claude', args: ['--print'], timeout: 600 },
      'plan-agent': { cli: 'aider', args: ['--yes', '--message'], timeout: 900 },
    });

    const result = resolveAgent('plan', runConfig);

    expect(result.cli).toBe('aider');
    expect(result.args).toEqual(['--yes', '--message']);
    expect(result.timeout).toBe(900);
  });

  it('tier 2: phase-specific build-agent overrides default for build mode', () => {
    const runConfig = makeRunConfig({
      agent: { cli: 'claude', args: ['--print'], timeout: 600 },
      'build-agent': { cli: 'codex', args: ['--quiet'], timeout: 2400 },
    });

    const result = resolveAgent('build', runConfig);

    expect(result.cli).toBe('codex');
    expect(result.args).toEqual(['--quiet']);
    expect(result.timeout).toBe(2400);
  });

  it('tier 2: null plan-agent falls through to default agent', () => {
    const runConfig = makeRunConfig({
      agent: { cli: 'claude', args: ['--print'], timeout: 600 },
      'plan-agent': null,
    });

    const result = resolveAgent('plan', runConfig);

    expect(result.cli).toBe('claude');
    expect(result.args).toEqual(['--print']);
  });

  it('tier 1: --agent flag overrides cli (same cli as config)', () => {
    const runConfig = makeRunConfig({
      agent: { cli: 'claude', args: ['--print', '--model', 'sonnet'], timeout: 1800 },
    });

    // Same CLI, but explicitly passed
    const result = resolveAgent('plan', runConfig, 'claude');

    expect(result.cli).toBe('claude');
    expect(result.args).toEqual(['--print', '--model', 'sonnet']);
  });

  it('tier 1: --agent flag changes CLI to different agent, uses preset args', () => {
    const runConfig = makeRunConfig({
      agent: { cli: 'claude', args: ['--print', '--model', 'sonnet'], timeout: 1800 },
    });

    // Switch to codex — should use codex preset args, not claude's config args
    const result = resolveAgent('build', runConfig, 'codex');

    expect(result.cli).toBe('codex');
    expect(result.args).toEqual(AGENT_PRESETS['codex']!.args);
    expect(result.timeout).toBe(1800); // default timeout when preset has none
  });

  it('tier 4: preset args used when --agent changes CLI to unknown agent', () => {
    const runConfig = makeRunConfig({
      agent: { cli: 'claude', args: ['--print'], timeout: 1800 },
    });

    const result = resolveAgent('build', runConfig, 'my-custom-agent');

    expect(result.cli).toBe('my-custom-agent');
    expect(result.args).toEqual([]); // no preset for unknown agent
    expect(result.timeout).toBe(1800);
  });

  it('model injection via cliModel', () => {
    const runConfig = makeRunConfig({
      agent: { cli: 'claude', args: ['--print', '--model', 'sonnet'], timeout: 1800 },
    });

    const result = resolveAgent('plan', runConfig, undefined, 'opus');

    expect(result.args).toEqual(['--print', '--model', 'opus']);
  });

  it('model injection with --agent flag and model override', () => {
    const runConfig = makeRunConfig({
      agent: { cli: 'claude', args: ['--print', '--model', 'sonnet'], timeout: 1800 },
    });

    // Same CLI, model override
    const result = resolveAgent('plan', runConfig, 'claude', 'opus');

    expect(result.cli).toBe('claude');
    expect(result.args).toEqual(['--print', '--model', 'opus']);
  });

  it('config args fully replace preset when CLI matches config', () => {
    // Config has custom subset of args — should not be merged with preset
    const runConfig = makeRunConfig({
      agent: { cli: 'claude', args: ['--print', '--model', 'sonnet'], timeout: 1800 },
    });

    const result = resolveAgent('build', runConfig);

    // Should not include --dangerously-skip-permissions or --verbose from claude preset
    expect(result.args).toEqual(['--print', '--model', 'sonnet']);
    expect(result.args).not.toContain('--dangerously-skip-permissions');
    expect(result.args).not.toContain('--verbose');
  });

  it('phase-specific args fully replace preset args', () => {
    const runConfig = makeRunConfig({
      'build-agent': { cli: 'codex', args: ['--quiet'], timeout: 2400 },
    });

    const result = resolveAgent('build', runConfig);

    // Should use only ['--quiet'], not merged with codex preset
    expect(result.args).toEqual(['--quiet']);
    expect(result.args).not.toContain('--approval-mode');
  });
});

// ─── injectModel ─────────────────────────────────────────────────────────────

describe('injectModel', () => {
  it('replaces value after --model flag', () => {
    const args = ['--print', '--model', 'sonnet', '--verbose'];
    expect(injectModel(args, 'opus')).toEqual(['--print', '--model', 'opus', '--verbose']);
  });

  it('replaces --model= form', () => {
    const args = ['--print', '--model=sonnet'];
    expect(injectModel(args, 'opus')).toEqual(['--print', '--model=opus']);
  });

  it('appends --model value when not found', () => {
    const args = ['--print', '--verbose'];
    expect(injectModel(args, 'opus')).toEqual(['--print', '--verbose', '--model', 'opus']);
  });

  it('appends --model value to empty args', () => {
    expect(injectModel([], 'sonnet')).toEqual(['--model', 'sonnet']);
  });

  it('replaces only the first --model occurrence', () => {
    const args = ['--model', 'sonnet', '--model', 'haiku'];
    expect(injectModel(args, 'opus')).toEqual(['--model', 'opus', '--model', 'haiku']);
  });

  it('does not mutate input array', () => {
    const args = ['--model', 'sonnet'];
    const result = injectModel(args, 'opus');
    expect(args).toEqual(['--model', 'sonnet']); // unchanged
    expect(result).toEqual(['--model', 'opus']);
  });

  it('handles --model at end of args (no next value)', () => {
    const args = ['--print', '--model'];
    // --model at end with no value — should append new model
    const result = injectModel(args, 'opus');
    // Since i+1 >= length, falls through to append
    expect(result).toEqual(['--print', '--model', '--model', 'opus']);
  });
});
