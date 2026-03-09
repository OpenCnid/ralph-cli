import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../src/config/loader.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('../src/commands/run/agent.js', () => ({
  resolveAgent: vi.fn(),
  spawnAgent: vi.fn(),
}));

vi.mock('../src/commands/run/detect.js', () => ({
  detectTestCommand: vi.fn(),
  detectTypecheckCommand: vi.fn(),
  composeValidateCommand: vi.fn(),
}));

vi.mock('../src/utils/output.js', () => ({
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  heading: vi.fn(),
  plain: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'node:child_process';
import { loadConfig } from '../src/config/loader.js';
import { diagnosticRuntime } from '../src/commands/heal/diagnostics.js';
import { healCommand } from '../src/commands/heal/index.js';
import { resolveAgent, spawnAgent } from '../src/commands/run/agent.js';
import {
  composeValidateCommand,
  detectTestCommand,
  detectTypecheckCommand,
} from '../src/commands/run/detect.js';
import * as outputMod from '../src/utils/output.js';
import type { LoadResult } from '../src/config/loader.js';
import type { RalphConfig } from '../src/config/schema.js';

const mockExecSync = vi.mocked(execSync);
const mockLoadConfig = vi.mocked(loadConfig);
const mockResolveAgent = vi.mocked(resolveAgent);
const mockSpawnAgent = vi.mocked(spawnAgent);
const mockDetectTestCommand = vi.mocked(detectTestCommand);
const mockDetectTypecheckCommand = vi.mocked(detectTypecheckCommand);
const mockComposeValidateCommand = vi.mocked(composeValidateCommand);
const mockSuccess = vi.mocked(outputMod.success);
const mockWarn = vi.mocked(outputMod.warn);
const mockError = vi.mocked(outputMod.error);
const mockInfo = vi.mocked(outputMod.info);
const mockPlain = vi.mocked(outputMod.plain);

function makeConfig(overrides: Partial<RalphConfig> = {}): RalphConfig {
  return {
    project: { name: 'ralph-cli', language: 'typescript' },
    architecture: {
      layers: [],
      direction: 'forward-only',
      rules: { 'max-lines': 500, naming: { schemas: '*Schema', types: '*Type' } },
    },
    quality: { 'minimum-grade': 'B', coverage: { tool: 'none', 'report-path': '' } },
    gc: { 'consistency-threshold': 70, exclude: [] },
    doctor: { 'minimum-score': 8, 'custom-checks': [] },
    paths: {
      'agents-md': 'AGENTS.md',
      'architecture-md': 'ARCHITECTURE.md',
      docs: 'docs',
      specs: 'docs/product-specs',
      plans: 'docs/exec-plans',
      'design-docs': 'docs/design-docs',
      references: 'docs/references',
      generated: 'docs/generated',
      quality: 'docs/QUALITY_SCORE.md',
    },
    references: { 'max-total-kb': 200, 'warn-single-file-kb': 80 },
    run: {
      agent: { cli: 'codex', args: ['--model', 'o3'], timeout: 1800 },
      'plan-agent': null,
      'build-agent': null,
      prompts: { plan: null, build: null },
      loop: { 'max-iterations': 0, 'stall-threshold': 3 },
      validation: { 'test-command': null, 'typecheck-command': null },
      git: { 'auto-commit': true, 'auto-push': false, 'commit-prefix': 'ralph:', branch: null },
    },
    review: {
      agent: null,
      scope: 'staged',
      context: {
        'include-specs': true,
        'include-architecture': true,
        'include-diff-context': 5,
        'max-diff-lines': 2000,
      },
      output: { format: 'text', file: null, 'severity-threshold': 'info' },
    },
    heal: {
      agent: null,
      commands: ['doctor', 'grade', 'gc', 'lint'],
      'auto-commit': true,
      'commit-prefix': 'ralph: heal',
    },
    ...overrides,
  };
}

function makeLoadResult(overrides: Partial<RalphConfig> = {}): LoadResult {
  return {
    config: makeConfig(overrides),
    configPath: '.ralph/config.yml',
    warnings: [],
  };
}

function queueResults(
  mockRunCommand: ReturnType<typeof vi.spyOn<typeof diagnosticRuntime, 'runCommand'>>,
  results: Array<{ output: string; exitCode: number }>,
): void {
  for (const result of results) {
    mockRunCommand.mockResolvedValueOnce(result);
  }
}

function mockGitRepo(options: { hasChanges?: boolean; commitHash?: string } = {}): void {
  const hasChanges = options.hasChanges ?? true;
  const commitHash = options.commitHash ?? 'abc1234';

  mockExecSync.mockImplementation((command: string) => {
    if (command === 'git rev-parse --is-inside-work-tree') return 'true\n';
    if (command === 'git status --porcelain') return hasChanges ? ' M src/commands/heal/index.ts\n' : '';
    if (command === 'git add -A') return '';
    if (command.startsWith('git commit -m ')) return '';
    if (command === 'git rev-parse --short HEAD') return `${commitHash}\n`;
    throw new Error(`Unexpected execSync command: ${command}`);
  });
}

let tmpDir: string;
let origCwd: string;
let mockExit: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  origCwd = process.cwd();
  tmpDir = mkdtempSync(join(tmpdir(), 'ralph-heal-'));
  mkdirSync(join(tmpDir, '.git'), { recursive: true });
  process.chdir(tmpDir);

  vi.clearAllMocks();
  vi.restoreAllMocks();

  mockLoadConfig.mockReturnValue(makeLoadResult());
  mockResolveAgent.mockReturnValue({ cli: 'codex', args: ['--model', 'o3'], timeout: 1800 });
  mockSpawnAgent.mockResolvedValue({ exitCode: 0, durationMs: 3000 });
  mockDetectTestCommand.mockReturnValue('npm test');
  mockDetectTypecheckCommand.mockReturnValue('npx tsc --noEmit');
  mockComposeValidateCommand.mockReturnValue('npm test && npx tsc --noEmit && ralph doctor --ci && ralph grade --ci');
  mockGitRepo();

  mockExit = vi.spyOn(process, 'exit').mockImplementation((_code?: string | number | null) => {
    throw new Error(`process.exit(${_code})`);
  }) as ReturnType<typeof vi.spyOn>;
});

afterEach(() => {
  process.chdir(origCwd);
  rmSync(tmpDir, { recursive: true, force: true });
  mockExit.mockRestore();
  vi.restoreAllMocks();
});

describe('healCommand', () => {
  it('all diagnostics pass and exits cleanly without spawning an agent', async () => {
    const mockRunCommand = vi.spyOn(diagnosticRuntime, 'runCommand');
    queueResults(mockRunCommand, [
      { output: '✓ All checks passed', exitCode: 0 },
      { output: 'Overall grade A', exitCode: 0 },
      { output: 'No drift detected', exitCode: 0 },
      { output: 'No issues found.', exitCode: 0 },
    ]);

    await healCommand({});

    expect(mockSpawnAgent).not.toHaveBeenCalled();
    expect(mockSuccess).toHaveBeenCalledWith('All clear — nothing to heal.');
  });

  it('spawns the agent with doctor output when only doctor has issues', async () => {
    const mockRunCommand = vi.spyOn(diagnosticRuntime, 'runCommand');
    queueResults(mockRunCommand, [
      { output: '✗ AGENTS.md missing or empty', exitCode: 1 },
      { output: 'Overall grade A', exitCode: 0 },
      { output: 'No drift detected', exitCode: 0 },
      { output: 'No issues found.', exitCode: 0 },
      { output: '✓ All checks passed', exitCode: 0 },
      { output: 'Overall grade A', exitCode: 0 },
      { output: 'No drift detected', exitCode: 0 },
      { output: 'No issues found.', exitCode: 0 },
    ]);

    await healCommand({});

    expect(mockSpawnAgent).toHaveBeenCalledOnce();
    const prompt = mockSpawnAgent.mock.calls[0]![1];
    expect(prompt).toContain('### ralph doctor');
    expect(prompt).toContain('✗ AGENTS.md missing or empty');
    expect(prompt).not.toContain('### ralph grade --ci');
  });

  it('includes multiple failing diagnostics in the generated prompt', async () => {
    const mockRunCommand = vi.spyOn(diagnosticRuntime, 'runCommand');
    queueResults(mockRunCommand, [
      { output: '✗ AGENTS.md missing or empty', exitCode: 1 },
      { output: 'Overall grade D', exitCode: 1 },
      { output: '⚠ Orphaned file: src/old.ts', exitCode: 1 },
      { output: 'No issues found.', exitCode: 0 },
      { output: '✓ All checks passed', exitCode: 0 },
      { output: 'Overall grade A', exitCode: 0 },
      { output: 'No drift detected', exitCode: 0 },
      { output: 'No issues found.', exitCode: 0 },
    ]);

    await healCommand({});

    const prompt = mockSpawnAgent.mock.calls[0]![1];
    expect(prompt).toContain('### ralph doctor');
    expect(prompt).toContain('### ralph grade --ci');
    expect(prompt).toContain('### ralph gc');
    expect(prompt).toContain('doctor');
    expect(prompt).toContain('lint');
    expect(prompt).toContain('gc');
    expect(prompt).toContain('grade');
  });

  it('prints the generated prompt in dry-run mode without spawning', async () => {
    const mockRunCommand = vi.spyOn(diagnosticRuntime, 'runCommand');
    queueResults(mockRunCommand, [
      { output: '✗ AGENTS.md missing or empty', exitCode: 1 },
      { output: 'Overall grade A', exitCode: 0 },
      { output: 'No drift detected', exitCode: 0 },
      { output: 'No issues found.', exitCode: 0 },
    ]);

    await healCommand({ dryRun: true });

    expect(mockSpawnAgent).not.toHaveBeenCalled();
    expect(mockPlain).toHaveBeenCalledOnce();
    expect(mockPlain.mock.calls[0]![0]).toContain('### ralph doctor');
  });

  it('--only doctor limits diagnostics to doctor', async () => {
    const mockRunCommand = vi.spyOn(diagnosticRuntime, 'runCommand');
    queueResults(mockRunCommand, [
      { output: '✗ AGENTS.md missing or empty', exitCode: 1 },
    ]);

    await healCommand({ only: 'doctor', dryRun: true });

    expect(mockRunCommand).toHaveBeenCalledTimes(1);
    expect(mockRunCommand).toHaveBeenCalledWith('ralph doctor');
    expect(mockPlain.mock.calls[0]![0]).not.toContain('### ralph grade --ci');
  });

  it('--skip grade skips the grade diagnostic', async () => {
    const mockRunCommand = vi.spyOn(diagnosticRuntime, 'runCommand');
    queueResults(mockRunCommand, [
      { output: '✗ AGENTS.md missing or empty', exitCode: 1 },
      { output: 'No drift detected', exitCode: 0 },
      { output: 'No issues found.', exitCode: 0 },
    ]);

    await healCommand({ skip: 'grade', dryRun: true });

    expect(mockRunCommand).toHaveBeenCalledTimes(3);
    expect(mockRunCommand).not.toHaveBeenCalledWith('ralph grade --ci');
  });

  it('--no-commit skips git operations', async () => {
    const mockRunCommand = vi.spyOn(diagnosticRuntime, 'runCommand');
    queueResults(mockRunCommand, [
      { output: '✗ AGENTS.md missing or empty', exitCode: 1 },
      { output: 'Overall grade A', exitCode: 0 },
      { output: 'No drift detected', exitCode: 0 },
      { output: 'No issues found.', exitCode: 0 },
      { output: '✓ All checks passed', exitCode: 0 },
      { output: 'Overall grade A', exitCode: 0 },
      { output: 'No drift detected', exitCode: 0 },
      { output: 'No issues found.', exitCode: 0 },
    ]);

    await healCommand({ noCommit: true });

    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('uses heal.agent as the base agent configuration before CLI overrides', async () => {
    mockLoadConfig.mockReturnValue(
      makeLoadResult({
        heal: {
          agent: { cli: 'aider', args: ['--yes'], timeout: 900 },
          commands: ['doctor', 'grade', 'gc', 'lint'],
          'auto-commit': false,
          'commit-prefix': 'ralph: heal',
        },
      }),
    );

    const mockRunCommand = vi.spyOn(diagnosticRuntime, 'runCommand');
    queueResults(mockRunCommand, [
      { output: '✗ AGENTS.md missing or empty', exitCode: 1 },
      { output: 'Overall grade A', exitCode: 0 },
      { output: 'No drift detected', exitCode: 0 },
      { output: 'No issues found.', exitCode: 0 },
      { output: '✓ All checks passed', exitCode: 0 },
      { output: 'Overall grade A', exitCode: 0 },
      { output: 'No drift detected', exitCode: 0 },
      { output: 'No issues found.', exitCode: 0 },
    ]);

    await healCommand({ agent: 'codex', model: 'o4-mini', verbose: true });

    expect(mockResolveAgent).toHaveBeenCalledWith(
      'build',
      expect.objectContaining({
        agent: { cli: 'aider', args: ['--yes'], timeout: 900 },
        'build-agent': null,
      }),
      'codex',
      'o4-mini',
    );
    expect(mockSpawnAgent).toHaveBeenCalledWith(
      { cli: 'codex', args: ['--model', 'o3'], timeout: 1800 },
      expect.any(String),
      { verbose: true },
    );
  });

  it('re-runs diagnostics after the agent finishes and reports success', async () => {
    const mockRunCommand = vi.spyOn(diagnosticRuntime, 'runCommand');
    queueResults(mockRunCommand, [
      { output: '✗ AGENTS.md missing or empty', exitCode: 1 },
      { output: 'Overall grade A', exitCode: 0 },
      { output: 'No drift detected', exitCode: 0 },
      { output: 'No issues found.', exitCode: 0 },
      { output: '✓ All checks passed', exitCode: 0 },
      { output: 'Overall grade A', exitCode: 0 },
      { output: 'No drift detected', exitCode: 0 },
      { output: 'No issues found.', exitCode: 0 },
    ]);

    await healCommand({});

    expect(mockRunCommand).toHaveBeenCalledTimes(8);
    expect(mockInfo).toHaveBeenCalledWith('Verifying fixes...');
    expect(mockSuccess).toHaveBeenCalledWith('All issues resolved!');
  });

  it('reports remaining issues after verification', async () => {
    const mockRunCommand = vi.spyOn(diagnosticRuntime, 'runCommand');
    queueResults(mockRunCommand, [
      { output: '✗ AGENTS.md missing or empty', exitCode: 1 },
      { output: 'Overall grade A', exitCode: 0 },
      { output: 'No drift detected', exitCode: 0 },
      { output: 'No issues found.', exitCode: 0 },
      { output: '✗ AGENTS.md missing or empty', exitCode: 1 },
      { output: 'Overall grade A', exitCode: 0 },
      { output: 'No drift detected', exitCode: 0 },
      { output: 'No issues found.', exitCode: 0 },
    ]);

    await healCommand({});

    expect(mockWarn).toHaveBeenCalledWith('1 issue(s) remain after healing. Manual review needed.');
  });

  it('warns and skips diagnostics that fail to execute', async () => {
    const mockRunCommand = vi.spyOn(diagnosticRuntime, 'runCommand');
    queueResults(mockRunCommand, [
      { output: '✗ AGENTS.md missing or empty', exitCode: 1 },
      { output: 'ralph: command not found', exitCode: 127 },
      { output: 'No drift detected', exitCode: 0 },
      { output: 'No issues found.', exitCode: 0 },
      { output: '✓ All checks passed', exitCode: 0 },
      { output: 'ralph: command not found', exitCode: 127 },
      { output: 'No drift detected', exitCode: 0 },
      { output: 'No issues found.', exitCode: 0 },
    ]);

    await healCommand({});

    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('Skipping ralph grade --ci'));
    const prompt = mockSpawnAgent.mock.calls[0]![1];
    expect(prompt).not.toContain('### ralph grade --ci');
  });

  it('skips commit without error when not in a git repository', async () => {
    mockExecSync.mockImplementation((command: string) => {
      if (command === 'git rev-parse --is-inside-work-tree') {
        throw new Error('not a git repo');
      }
      throw new Error(`Unexpected execSync command: ${command}`);
    });

    const mockRunCommand = vi.spyOn(diagnosticRuntime, 'runCommand');
    queueResults(mockRunCommand, [
      { output: '✗ AGENTS.md missing or empty', exitCode: 1 },
      { output: 'Overall grade A', exitCode: 0 },
      { output: 'No drift detected', exitCode: 0 },
      { output: 'No issues found.', exitCode: 0 },
      { output: '✓ All checks passed', exitCode: 0 },
      { output: 'Overall grade A', exitCode: 0 },
      { output: 'No drift detected', exitCode: 0 },
      { output: 'No issues found.', exitCode: 0 },
    ]);

    await healCommand({});

    expect(mockWarn).toHaveBeenCalledWith('Not a git repository. Skipping commit.');
  });

  it('prints agent errors and exits non-zero when the agent cannot start', async () => {
    const mockRunCommand = vi.spyOn(diagnosticRuntime, 'runCommand');
    queueResults(mockRunCommand, [
      { output: '✗ AGENTS.md missing or empty', exitCode: 1 },
      { output: 'Overall grade A', exitCode: 0 },
      { output: 'No drift detected', exitCode: 0 },
      { output: 'No issues found.', exitCode: 0 },
    ]);
    mockSpawnAgent.mockResolvedValue({
      exitCode: 1,
      durationMs: 0,
      error: 'Agent CLI "missing-cli" not found. Install it and ensure it is in PATH.',
    });

    await expect(healCommand({})).rejects.toThrow('process.exit(1)');
    expect(mockError).toHaveBeenCalledWith(expect.stringContaining('missing-cli'));
  });
});
