import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mkdirSync, writeFileSync, readFileSync, mkdtempSync, rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ─── Mocks ───────────────────────────────────────────────────────────────────
// progress.js, prompts.js, detect.js are NOT mocked:
//   – loadCheckpoint/saveCheckpoint exercise real filesystem (temp dir)
//   – generatePrompt exercises real variable substitution
// child_process, agent.js, config/loader.js, output.js, timeout.js are mocked.

vi.mock('node:child_process', () => ({ execSync: vi.fn() }));

vi.mock('./agent.js', () => ({
  spawnAgent: vi.fn(),
  resolveAgent: vi.fn(),
}));

vi.mock('./timeout.js', () => ({
  spawnAgentWithTimeout: vi.fn(),
}));

vi.mock('./lock.js', () => ({
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
  isLockHeld: vi.fn(),
}));

vi.mock('../../config/loader.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('../../utils/output.js', () => ({
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  heading: vi.fn(),
  plain: vi.fn(),
}));

// ─── Imports after mocks ─────────────────────────────────────────────────────

import { execSync } from 'node:child_process';
import { loadConfig } from '../../config/loader.js';
import { spawnAgent, resolveAgent } from './agent.js';
import { spawnAgentWithTimeout } from './timeout.js';
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
const mockResolveAgent = vi.mocked(resolveAgent);
const mockWarn = vi.mocked(outputMod.warn);
const mockError = vi.mocked(outputMod.error);
const mockPlain = vi.mocked(outputMod.plain);

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
      run: makeRunConfig(runOverrides),
    } as RalphConfig,
    configPath: null,
    warnings: [],
  };
}

/** Read checkpoint from the real temp-dir filesystem. */
function readCheckpoint(dir: string): Checkpoint {
  const raw = readFileSync(join(dir, '.ralph', 'run-checkpoint.json'), 'utf-8');
  return JSON.parse(raw) as Checkpoint;
}

// ─── Test setup ──────────────────────────────────────────────────────────────

let tmpDir: string;
let origCwd: string;

beforeEach(() => {
  vi.clearAllMocks();

  origCwd = process.cwd();
  tmpDir = mkdtempSync(join(tmpdir(), 'ralph-int-'));
  mkdirSync(join(tmpDir, '.git'), { recursive: true });
  mkdirSync(join(tmpDir, '.ralph'), { recursive: true });
  writeFileSync(join(tmpDir, 'IMPLEMENTATION_PLAN.md'), '# Plan\n- [ ] Task 1\n');
  process.chdir(tmpDir);

  mockLoadConfig.mockReturnValue(makeLoadResult());
  mockResolveAgent.mockReturnValue(makeAgentConfig());
  mockSpawnAgent.mockResolvedValue({ exitCode: 0, durationMs: 1000 });

  // spawnAgentWithTimeout delegates to spawnAgent so existing assertions still work
  mockSpawnAgentWithTimeout.mockImplementation(
    (_config: AgentConfig, prompt: string, _timeout: number, opts?: { verbose?: boolean | undefined; capture?: boolean | undefined }) =>
      mockSpawnAgent(_config, prompt, opts),
  );

  // Default git mock: banner branch + short hash, no changes
  mockExecSync.mockImplementation((cmd: unknown) => {
    const c = String(cmd);
    if (c.includes('git status --porcelain')) return '';
    if (c.includes('git rev-parse')) return 'abc1234\n';
    return '';
  });

  vi.spyOn(process, 'exit').mockImplementation((_code?: string | number | null) => {
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

// ─── 1. Full build cycle (3 iterations) ──────────────────────────────────────

describe('integration — full build cycle', () => {
  it('runs 3 iterations; checkpoint on disk has 3 history records with commits', async () => {
    mockLoadConfig.mockReturnValue(makeLoadResult({
      loop: { 'max-iterations': 3, 'stall-threshold': 0, 'iteration-timeout': 900 },
    }));
    // Each iteration: git shows changes → commit path runs
    mockExecSync.mockImplementation((cmd: unknown) => {
      const c = String(cmd);
      if (c.includes('git status --porcelain')) return 'M src/foo.ts\n';
      if (c.includes('git rev-parse')) return 'deadbee\n';
      return '';
    });

    await runCommand('build', {});

    expect(mockSpawnAgent).toHaveBeenCalledTimes(3);
    const cp = readCheckpoint(tmpDir);
    expect(cp.iteration).toBe(3);
    expect(cp.history).toHaveLength(3);
    expect(cp.history.every((r) => r.exitCode === 0)).toBe(true);
    expect(cp.history.every((r) => r.commit === 'deadbee')).toBe(true);
  });
});

// ─── 2. Plan mode completion ──────────────────────────────────────────────────

describe('integration — plan mode completion', () => {
  it('stops after 2 iterations when plan file is unchanged on the second call', async () => {
    const specsDir = join(tmpDir, 'docs', 'product-specs');
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, 'spec.md'), '# Spec\n');

    mockLoadConfig.mockReturnValue(makeLoadResult({
      loop: { 'max-iterations': 0, 'stall-threshold': 0, 'iteration-timeout': 900 },
      git: { 'auto-commit': false, 'auto-push': false, 'commit-prefix': 'ralph:', branch: null },
    }));

    let call = 0;
    mockSpawnAgent.mockImplementation(async () => {
      call++;
      if (call === 1) {
        // Iteration 1: agent rewrites plan — planBefore ≠ planAfter → continue
        writeFileSync(join(tmpDir, 'IMPLEMENTATION_PLAN.md'), '# Updated\n- [ ] New task\n');
      }
      // Iteration 2: agent does nothing — planBefore === planAfter → "plan complete"
      return { exitCode: 0, durationMs: 500 };
    });

    await runCommand('plan', {});

    expect(mockSpawnAgent).toHaveBeenCalledTimes(2);
    const cp = readCheckpoint(tmpDir);
    expect(cp.history).toHaveLength(2);
    expect(cp.phase).toBe('plan');
  });
});

// ─── 3. Agent timeout ────────────────────────────────────────────────────────

describe('integration — agent timeout', () => {
  it('records timeout in checkpoint; loop runs to max-iterations', async () => {
    mockLoadConfig.mockReturnValue(makeLoadResult({
      loop: { 'max-iterations': 1, 'stall-threshold': 0, 'iteration-timeout': 900 },
    }));
    // error containing 'timed out' is treated as equivalent to timedOut:true per spec
    mockSpawnAgent.mockResolvedValue({ exitCode: 1, durationMs: 1000, error: 'timed out' });

    await runCommand('build', {});

    // Timeout path: reverts baseline and continues (no 'Agent spawn failed' warning)
    const cp = readCheckpoint(tmpDir);
    expect(cp.history).toHaveLength(1);
    expect(cp.history[0]?.error).toBe('timed out');
    expect(cp.history[0]?.exitCode).toBe(1);
  });
});

// ─── 4. --resume from checkpoint ─────────────────────────────────────────────

describe('integration — resume from checkpoint', () => {
  it('starts at iteration 3 when on-disk checkpoint has iteration=2', async () => {
    const saved: Checkpoint = {
      version: 1,
      phase: 'build',
      startedAt: new Date().toISOString(),
      iteration: 2,
      history: [
        { iteration: 1, durationMs: 1000, exitCode: 0, commit: 'aaa1111' },
        { iteration: 2, durationMs: 1000, exitCode: 0, commit: 'bbb2222' },
      ],
    };
    writeFileSync(
      join(tmpDir, '.ralph', 'run-checkpoint.json'),
      JSON.stringify(saved, null, 2),
    );
    mockLoadConfig.mockReturnValue(makeLoadResult({
      loop: { 'max-iterations': 3, 'stall-threshold': 0, 'iteration-timeout': 900 },
    }));

    await runCommand('build', { resume: true });

    // Only one additional iteration (iteration 3) should run
    expect(mockSpawnAgent).toHaveBeenCalledTimes(1);
    const cp = readCheckpoint(tmpDir);
    expect(cp.iteration).toBe(3);
    expect(cp.history).toHaveLength(3);
  });
});

// ─── 5. --resume phase mismatch (non-TTY) ────────────────────────────────────

describe('integration — resume phase mismatch', () => {
  it('exits with error in non-TTY when checkpoint phase differs from requested mode', async () => {
    const saved: Checkpoint = {
      version: 1,
      phase: 'plan',
      startedAt: new Date().toISOString(),
      iteration: 2,
      history: [],
    };
    writeFileSync(
      join(tmpDir, '.ralph', 'run-checkpoint.json'),
      JSON.stringify(saved, null, 2),
    );

    // process.stdout.isTTY is undefined in tests (non-TTY path)
    await expect(runCommand('build', { resume: true })).rejects.toThrow('process.exit(1)');
    expect(mockError).toHaveBeenCalledWith(expect.stringContaining('phase mismatch'));
  });
});

// ─── 6. Stall detection (non-TTY) ────────────────────────────────────────────

describe('integration — stall detection', () => {
  it('halts loop after stall-threshold no-change iterations in non-TTY', async () => {
    mockLoadConfig.mockReturnValue(makeLoadResult({
      loop: { 'max-iterations': 0, 'stall-threshold': 3, 'iteration-timeout': 900 },
    }));
    // git status always empty → noChangesCount increments every iteration
    mockExecSync.mockImplementation((cmd: unknown) => {
      const c = String(cmd);
      if (c.includes('git rev-parse')) return 'main\n';
      return '';
    });

    await runCommand('build', {});

    expect(mockSpawnAgent).toHaveBeenCalledTimes(3);
    const cp = readCheckpoint(tmpDir);
    expect(cp.history).toHaveLength(3);
  });
});

// ─── 7. Custom prompt template ────────────────────────────────────────────────

describe('integration — custom prompt template', () => {
  it('substitutes {project_name} in a custom build template and passes result to spawnAgent', async () => {
    const templatePath = join(tmpDir, 'custom.txt');
    writeFileSync(templatePath, 'Hello {project_name} custom template!');

    mockLoadConfig.mockReturnValue(makeLoadResult({
      prompts: { plan: null, build: templatePath },
      loop: { 'max-iterations': 1, 'stall-threshold': 0, 'iteration-timeout': 900 },
    }));

    await runCommand('build', {});

    expect(mockSpawnAgent).toHaveBeenCalledOnce();
    // Second argument to spawnAgent is the rendered prompt
    const prompt = mockSpawnAgent.mock.calls[0]?.[1];
    expect(String(prompt)).toContain('Hello test custom template!');
    expect(String(prompt)).not.toContain('{project_name}');
  });
});

// ─── 8. --dry-run ─────────────────────────────────────────────────────────────

describe('integration — dry-run', () => {
  it('prints generated prompt to output and never spawns the agent', async () => {
    await runCommand('build', { dryRun: true });

    expect(mockSpawnAgent).not.toHaveBeenCalled();
    expect(mockPlain).toHaveBeenCalled();

    // Real BUILD_TEMPLATE is used — verify prompt is a non-empty string
    const printed = mockPlain.mock.calls[0]?.[0];
    expect(typeof printed).toBe('string');
    expect((printed as string).length).toBeGreaterThan(100);
  });
});

// ─── 9. --no-commit ───────────────────────────────────────────────────────────

describe('integration — no-commit', () => {
  it('skips git add and git commit even when the working tree has changes', async () => {
    mockExecSync.mockImplementation((cmd: unknown) => {
      const c = String(cmd);
      if (c.includes('git status --porcelain')) return 'M src/foo.ts\n';
      if (c.includes('git rev-parse')) return 'abc1234\n';
      return '';
    });

    await runCommand('build', { noCommit: true });

    const calls = mockExecSync.mock.calls.map((c) => String(c[0]));
    expect(calls.some((c) => c.includes('git add'))).toBe(false);
    expect(calls.some((c) => c.includes('git commit'))).toBe(false);
  });
});

// ─── 10. Signal handler registration ─────────────────────────────────────────

describe('integration — signal handler registration', () => {
  it('registers SIGINT and SIGTERM handlers before the loop runs', async () => {
    const sigintBefore = process.listenerCount('SIGINT');
    const sigtermBefore = process.listenerCount('SIGTERM');

    await runCommand('build', {});

    expect(process.listenerCount('SIGINT')).toBeGreaterThan(sigintBefore);
    expect(process.listenerCount('SIGTERM')).toBeGreaterThan(sigtermBefore);
  });
});
