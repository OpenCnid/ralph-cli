import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SpawnSyncReturns } from 'node:child_process';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  rmSync: vi.fn(),
}));

vi.mock('../../utils/output.js', () => ({
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  heading: vi.fn(),
  plain: vi.fn(),
}));

vi.mock('./timeout.js', () => ({
  spawnAgentWithTimeout: vi.fn(),
}));

vi.mock('./git.js', () => ({
  revertToBaseline: vi.fn(),
}));

vi.mock('./prompts.js', () => ({
  generateAdversarialPrompt: vi.fn().mockReturnValue('adversary prompt'),
}));

vi.mock('./agent.js', () => ({
  AGENT_PRESETS: {
    claude: { args: ['--print', '--dangerously-skip-permissions'] },
    amp: { args: ['--auto'] },
  },
  injectModel: vi.fn((args: string[], model: string) => [...args, '--model', model]),
}));

// ─── Imports after mocks ─────────────────────────────────────────────────────

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { warn } from '../../utils/output.js';
import { spawnAgentWithTimeout } from './timeout.js';
import { revertToBaseline } from './git.js';
import {
  enforceFileRestriction,
  enforceTestDeletionGuard,
  pushDiagnosticBranch,
  runAdversarialPass,
  type TestSnapshot,
} from './adversarial.js';
import type { AdversarialConfig, RunConfig } from '../../config/schema.js';
import { DEFAULT_ADVERSARIAL } from '../../config/defaults.js';

// ─── Typed mocks ─────────────────────────────────────────────────────────────

const mockExecSync = vi.mocked(execSync);
const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockRmSync = vi.mocked(rmSync);
const mockWarn = vi.mocked(warn);
const mockSpawnAgentWithTimeout = vi.mocked(spawnAgentWithTimeout);
const mockRevertToBaseline = vi.mocked(revertToBaseline);
const mockSpawnSync = vi.mocked(spawnSync);

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<AdversarialConfig> = {}): AdversarialConfig {
  return { ...DEFAULT_ADVERSARIAL, ...overrides };
}

function makeRunConfig(overrides: Partial<RunConfig> = {}): RunConfig {
  return {
    agent: { cli: 'claude', args: ['--print'], timeout: 1800 },
    'plan-agent': null,
    'build-agent': null,
    prompts: {
      system: null,
      'plan-suffix': null,
      'build-suffix': null,
    },
    loop: {
      'max-iterations': 10,
      'stall-threshold': 3,
      'iteration-timeout': 0,
    },
    validation: {
      'test-command': 'npm test',
      'typecheck-command': null,
    },
    git: {
      'auto-commit': true,
      'auto-push': false,
      'commit-prefix': 'ralph',
      branch: null,
    },
    adversarial: DEFAULT_ADVERSARIAL,
    ...overrides,
  };
}

function makeSpawnResult(
  status: number,
  stdout = '',
  stderr = '',
): SpawnSyncReturns<string> {
  return {
    status,
    stdout,
    stderr,
    signal: null,
    pid: 12345,
    output: [null, stdout, stderr],
  };
}

// ─── enforceFileRestriction ───────────────────────────────────────────────────

describe('enforceFileRestriction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reverts non-test file and keeps test file', () => {
    const config = makeConfig();
    mockExecSync
      .mockReturnValueOnce('src/foo.ts\nsrc/foo.test.ts\n' as unknown as ReturnType<typeof execSync>)
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>) // git checkout HEAD -- src/foo.ts
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>); // git ls-files --others

    const result = enforceFileRestriction(config);

    expect(result.reverted).toContain('src/foo.ts');
    expect(result.reverted).not.toContain('src/foo.test.ts');
    // warn should be called since a file was reverted
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('src/foo.ts'));
  });

  it('reverts IMPLEMENTATION_PLAN.md (restricted pattern)', () => {
    const config = makeConfig();
    mockExecSync
      .mockReturnValueOnce('IMPLEMENTATION_PLAN.md\n' as unknown as ReturnType<typeof execSync>)
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>) // git checkout
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>); // git ls-files --others

    const result = enforceFileRestriction(config);

    expect(result.reverted).toContain('IMPLEMENTATION_PLAN.md');
    expect(mockWarn).toHaveBeenCalled();
  });

  it('reverts .ralph/config.yml (restricted pattern)', () => {
    const config = makeConfig();
    mockExecSync
      .mockReturnValueOnce('.ralph/config.yml\n' as unknown as ReturnType<typeof execSync>)
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>)
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>);

    const result = enforceFileRestriction(config);

    expect(result.reverted).toContain('.ralph/config.yml');
    expect(mockWarn).toHaveBeenCalled();
  });

  it('does not revert or warn when only test file changed', () => {
    const config = makeConfig();
    mockExecSync
      .mockReturnValueOnce('src/foo.test.ts\n' as unknown as ReturnType<typeof execSync>)
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>); // git ls-files --others

    const result = enforceFileRestriction(config);

    expect(result.reverted).toHaveLength(0);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('deletes untracked non-test files', () => {
    const config = makeConfig();
    mockExecSync
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>) // git diff --name-only
      .mockReturnValueOnce('src/extra.ts\n' as unknown as ReturnType<typeof execSync>); // git ls-files --others

    const result = enforceFileRestriction(config);

    expect(mockRmSync).toHaveBeenCalledWith('src/extra.ts', { force: true });
    expect(result.reverted).toContain('src/extra.ts');
  });

  it('keeps untracked test files', () => {
    const config = makeConfig();
    mockExecSync
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>) // git diff --name-only
      .mockReturnValueOnce('src/new.test.ts\n' as unknown as ReturnType<typeof execSync>); // git ls-files --others

    const result = enforceFileRestriction(config);

    expect(mockRmSync).not.toHaveBeenCalled();
    expect(result.reverted).toHaveLength(0);
  });
});

// ─── enforceTestDeletionGuard ─────────────────────────────────────────────────

describe('enforceTestDeletionGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('aborts and warns when test file is deleted', () => {
    const config = makeConfig();
    const snapshot: TestSnapshot = { testFiles: ['src/foo.test.ts'], testCount: null };
    mockExistsSync.mockReturnValue(false);

    const result = enforceTestDeletionGuard(config, snapshot, '');

    expect(result.abort).toBe(true);
    expect(result.reason).toContain('src/foo.test.ts');
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('src/foo.test.ts'));
  });

  it('aborts and warns when test count decreases (10→8)', () => {
    const config = makeConfig();
    const snapshot: TestSnapshot = { testFiles: ['src/foo.test.ts'], testCount: 10 };
    mockExistsSync.mockReturnValue(true);

    const result = enforceTestDeletionGuard(config, snapshot, '8 passed');

    expect(result.abort).toBe(true);
    expect(result.reason).toContain('10 → 8');
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('8'));
  });

  it('passes when test count increases (10→13)', () => {
    const config = makeConfig();
    const snapshot: TestSnapshot = { testFiles: ['src/foo.test.ts'], testCount: 10 };
    mockExistsSync.mockReturnValue(true);

    const result = enforceTestDeletionGuard(config, snapshot, '13 passed');

    expect(result.abort).toBe(false);
    expect(result.reason).toBe('');
  });

  it('passes when snapshot has no test files', () => {
    const config = makeConfig();
    const snapshot: TestSnapshot = { testFiles: [], testCount: null };

    const result = enforceTestDeletionGuard(config, snapshot, '');

    expect(result.abort).toBe(false);
  });
});

// ─── pushDiagnosticBranch ────────────────────────────────────────────────────

describe('pushDiagnosticBranch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates diagnostic branch with correct name when enabled', () => {
    mockExecSync.mockReturnValue('' as unknown as ReturnType<typeof execSync>);

    const branch = pushDiagnosticBranch(3, 2, true);

    expect(branch).toBe('ralph/adversarial/3');
    // Should have called git checkout -b, git add/commit, git checkout -
    expect(mockExecSync).toHaveBeenCalledWith(
      'git checkout -b ralph/adversarial/3',
      expect.anything(),
    );
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('ralph: adversarial tests (iteration 3, 2 failures)'),
      expect.anything(),
    );
    expect(mockExecSync).toHaveBeenCalledWith('git checkout -', expect.anything());
  });

  it('returns null when diagnostic-branch is false (no git commands)', () => {
    const branch = pushDiagnosticBranch(3, 2, false);

    expect(branch).toBeNull();
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('returns null and warns on git error (fail-open)', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if ((cmd as string).includes('checkout -b')) throw new Error('branch already exists');
      return '' as unknown as ReturnType<typeof execSync>;
    });

    const branch = pushDiagnosticBranch(5, 1, true);

    expect(branch).toBeNull();
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('ralph/adversarial/5'));
  });
});

// ─── runAdversarialPass ───────────────────────────────────────────────────────

describe('runAdversarialPass', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function baseOpts(overrides: Record<string, unknown> = {}) {
    return {
      config: makeConfig({ enabled: true }),
      runConfig: makeRunConfig(),
      iteration: 1,
      baselineCommit: 'abc123',
      originalBranch: 'main',
      preBuilderUntracked: [],
      stageResults: null,
      isSimplify: false,
      effectiveAutoCommit: true,
      verbose: false,
      ...overrides,
    };
  }

  it('skips with auto-commit disabled warning (AC-15)', async () => {
    const result = await runAdversarialPass(baseOpts({ effectiveAutoCommit: false }));

    expect(result.outcome).toBe('skip');
    expect(result.skipReason).toBe('auto-commit disabled');
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('auto-commit'));
  });

  it('skips in simplify mode when skip-on-simplify: true (AC-11)', async () => {
    const result = await runAdversarialPass(
      baseOpts({ isSimplify: true, config: makeConfig({ enabled: true, 'skip-on-simplify': true }) }),
    );

    expect(result.outcome).toBe('skip');
    expect(result.skipReason).toBe('simplify mode');
  });

  it('does not skip in simplify mode when skip-on-simplify: false', async () => {
    const config = makeConfig({ enabled: true, 'skip-on-simplify': false });
    // After the skip guard, it will try to list files and run agent
    mockExecSync
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>) // git ls-files (listTestFiles)
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>) // git ls-files --others (listTestFiles)
      .mockReturnValueOnce('(diff)' as unknown as ReturnType<typeof execSync>) // git diff HEAD~1 HEAD
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>) // git diff --name-only HEAD (getChangedTestFiles)
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>); // git ls-files --others (getChangedTestFiles)
    mockReadFileSync.mockReturnValue('plan content' as unknown as ReturnType<typeof readFileSync>);
    mockSpawnAgentWithTimeout.mockResolvedValue({ exitCode: 0, durationMs: 100 });
    // changedTestFiles is empty → skip('no tests written')
    const result = await runAdversarialPass(baseOpts({ isSimplify: true, config }));

    // Should reach 'no tests written' skip rather than 'simplify mode'
    expect(result.skipReason).not.toBe('simplify mode');
  });

  it('skips on agent timeout (AC-10)', async () => {
    mockExecSync
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>) // git ls-files
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>) // git ls-files --others
      .mockReturnValueOnce('diff output' as unknown as ReturnType<typeof execSync>); // git diff HEAD~1
    mockReadFileSync.mockReturnValue('plan' as unknown as ReturnType<typeof readFileSync>);
    mockSpawnAgentWithTimeout.mockResolvedValue({ exitCode: 1, durationMs: 300000, timedOut: true });

    const result = await runAdversarialPass(baseOpts());

    expect(result.outcome).toBe('skip');
    expect(result.skipReason).toBe('timeout');
    expect(mockRevertToBaseline).not.toHaveBeenCalled();
  });

  it('skips on agent spawn failure (fail-open)', async () => {
    mockExecSync
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>)
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>)
      .mockReturnValueOnce('diff' as unknown as ReturnType<typeof execSync>);
    mockReadFileSync.mockReturnValue('plan' as unknown as ReturnType<typeof readFileSync>);
    mockSpawnAgentWithTimeout.mockResolvedValue({
      exitCode: 1,
      durationMs: 50,
      error: 'Agent CLI "claude" not found',
    });

    const result = await runAdversarialPass(baseOpts());

    expect(result.outcome).toBe('skip');
    expect(result.skipReason).toBe('spawn failed');
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('spawn failed'));
  });

  it('skips when no test files were written (AC-16)', async () => {
    // Agent succeeds but writes no test files
    mockExecSync
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>) // git ls-files (listTestFiles)
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>) // git ls-files --others (listTestFiles)
      .mockReturnValueOnce('diff' as unknown as ReturnType<typeof execSync>) // git diff HEAD~1 HEAD
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>) // enforceFileRestriction: git diff --name-only
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>) // enforceFileRestriction: git ls-files --others
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>) // getChangedTestFiles: git diff --name-only
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>); // getChangedTestFiles: git ls-files --others
    mockReadFileSync.mockReturnValue('plan' as unknown as ReturnType<typeof readFileSync>);
    mockSpawnAgentWithTimeout.mockResolvedValue({ exitCode: 0, durationMs: 100 });

    const result = await runAdversarialPass(baseOpts());

    expect(result.outcome).toBe('skip');
    expect(result.skipReason).toBe('no tests written');
  });

  it('returns pass outcome and commits when tests pass (AC-5)', async () => {
    mockExecSync
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>) // git ls-files (listTestFiles)
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>) // git ls-files --others (listTestFiles)
      .mockReturnValueOnce('diff content' as unknown as ReturnType<typeof execSync>) // git diff HEAD~1 HEAD
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>) // enforceFileRestriction: git diff --name-only
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>) // enforceFileRestriction: git ls-files --others
      .mockReturnValueOnce('src/foo.test.ts\n' as unknown as ReturnType<typeof execSync>) // getChangedTestFiles: git diff --name-only
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>) // getChangedTestFiles: git ls-files --others
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>) // git add -A
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>); // git commit
    mockReadFileSync.mockReturnValue('plan' as unknown as ReturnType<typeof readFileSync>);
    mockSpawnAgentWithTimeout.mockResolvedValue({ exitCode: 0, durationMs: 100 });
    // spawnSync for runTestCommand → exit 0
    mockSpawnSync.mockReturnValue(makeSpawnResult(0, '10 passed', ''));
    mockExistsSync.mockReturnValue(true);

    const result = await runAdversarialPass(baseOpts());

    expect(result.outcome).toBe('pass');
    expect(result.testFilesAdded).toContain('src/foo.test.ts');
    expect(result.failedTests).toHaveLength(0);
    expect(mockRevertToBaseline).not.toHaveBeenCalled();
    // Commit should have been made
    expect(mockExecSync).toHaveBeenCalledWith('git add -A', expect.anything());
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('adversarial tests (iteration 1)'),
      expect.anything(),
    );
  });

  it('returns fail outcome, creates diagnostic branch, and reverts on failing tests (AC-6, AC-7)', async () => {
    mockExecSync
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>) // git ls-files (listTestFiles)
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>) // git ls-files --others (listTestFiles)
      .mockReturnValueOnce('diff content' as unknown as ReturnType<typeof execSync>) // git diff HEAD~1 HEAD
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>) // enforceFileRestriction: git diff --name-only
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>) // enforceFileRestriction: git ls-files --others
      .mockReturnValueOnce('src/foo.test.ts\n' as unknown as ReturnType<typeof execSync>) // getChangedTestFiles: git diff --name-only
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>) // getChangedTestFiles: git ls-files --others
      // pushDiagnosticBranch calls
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>) // git checkout -b
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>) // git add && git commit
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>); // git checkout -
    mockReadFileSync.mockReturnValue('plan' as unknown as ReturnType<typeof readFileSync>);
    mockSpawnAgentWithTimeout.mockResolvedValue({ exitCode: 0, durationMs: 100 });
    // spawnSync for runTestCommand → exit 1, test failure output
    mockSpawnSync.mockReturnValue(makeSpawnResult(1, '', '✗ should handle edge case\n1 failed'));
    mockExistsSync.mockReturnValue(true);

    const result = await runAdversarialPass(baseOpts());

    expect(result.outcome).toBe('fail');
    expect(result.diagnosticBranch).toBe('ralph/adversarial/1');
    expect(result.failedTests).toContain('should handle edge case');
    expect(mockRevertToBaseline).toHaveBeenCalledWith('abc123', 'main', []);
  });

  it('uses config.agent and config.model instead of runConfig.agent (AC-14)', async () => {
    const config = makeConfig({
      enabled: true,
      agent: 'amp',
      model: 'claude-3-5',
    });
    mockExecSync
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>)
      .mockReturnValueOnce('' as unknown as ReturnType<typeof execSync>)
      .mockReturnValueOnce('diff' as unknown as ReturnType<typeof execSync>);
    mockReadFileSync.mockReturnValue('plan' as unknown as ReturnType<typeof readFileSync>);
    mockSpawnAgentWithTimeout.mockResolvedValue({ exitCode: 1, durationMs: 50, timedOut: true });

    await runAdversarialPass(baseOpts({ config }));

    // The agent config passed to spawnAgentWithTimeout should use 'amp', not 'claude'
    const [calledAgentConfig] = mockSpawnAgentWithTimeout.mock.calls[0]!;
    expect(calledAgentConfig.cli).toBe('amp');
    expect(calledAgentConfig.args).toContain('--model');
    expect(calledAgentConfig.args).toContain('claude-3-5');
  });
});
