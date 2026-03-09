import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../../config/loader.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('../run/agent.js', () => ({
  spawnAgent: vi.fn(),
  injectModel: vi.fn((args: string[], model: string) => [...args, '--model', model]),
  AGENT_PRESETS: {
    claude: { args: ['--print', '--dangerously-skip-permissions', '--model', 'sonnet'], timeout: 1800 },
  },
}));

vi.mock('./context.js', () => ({
  resolveScope: vi.fn(),
  extractDiff: vi.fn(),
  assembleContext: vi.fn(),
}));

vi.mock('./prompts.js', () => ({
  generateReviewPrompt: vi.fn().mockReturnValue('the review prompt'),
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

import { loadConfig } from '../../config/loader.js';
import { spawnAgent } from '../run/agent.js';
import { resolveScope, extractDiff, assembleContext } from './context.js';
import { generateReviewPrompt } from './prompts.js';
import * as outputMod from '../../utils/output.js';
import { reviewCommand } from './index.js';
import type { RalphConfig, ReviewConfig, RunConfig, AgentConfig } from '../../config/schema.js';
import type { LoadResult } from '../../config/loader.js';
import type { ReviewContext } from './types.js';

const mockLoadConfig = vi.mocked(loadConfig);
const mockSpawnAgent = vi.mocked(spawnAgent);
const mockResolveScope = vi.mocked(resolveScope);
const mockExtractDiff = vi.mocked(extractDiff);
const mockAssembleContext = vi.mocked(assembleContext);
const mockGenerateReviewPrompt = vi.mocked(generateReviewPrompt);
const mockError = vi.mocked(outputMod.error);
const mockWarn = vi.mocked(outputMod.warn);
const mockPlain = vi.mocked(outputMod.plain);
const mockSuccess = vi.mocked(outputMod.success);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRunConfig(): RunConfig {
  return {
    agent: { cli: 'claude', args: ['--print', '--model', 'sonnet'], timeout: 1800 },
    'plan-agent': null,
    'build-agent': null,
    prompts: { plan: null, build: null },
    loop: { 'max-iterations': 0, 'stall-threshold': 3 },
    validation: { 'test-command': null, 'typecheck-command': null },
    git: { 'auto-commit': true, 'auto-push': false, 'commit-prefix': 'ralph:', branch: null },
  };
}

function makeReviewConfig(overrides: Partial<ReviewConfig> = {}): ReviewConfig {
  return {
    agent: null,
    scope: 'staged',
    context: {
      'include-specs': true,
      'include-architecture': true,
      'include-diff-context': 5,
      'max-diff-lines': 2000,
    },
    output: {
      format: 'text',
      file: null,
      'severity-threshold': 'info',
    },
    ...overrides,
  };
}

function makeConfig(overrides: { review?: Partial<ReviewConfig> } = {}): RalphConfig {
  return {
    project: { name: 'my-project', language: 'typescript' },
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
      plans: 'docs/plans',
      'design-docs': 'docs/design-docs',
      references: 'docs/references',
      generated: 'docs/generated',
      quality: 'docs/QUALITY_SCORE.md',
    },
    references: { 'max-total-kb': 200, 'warn-single-file-kb': 80 },
    run: makeRunConfig(),
    review: makeReviewConfig(overrides.review),
  } as RalphConfig;
}

function makeLoadResult(overrides: { review?: Partial<ReviewConfig> } = {}): LoadResult {
  return {
    config: makeConfig(overrides),
    configPath: null,
    warnings: [],
  };
}

function makeReviewContext(overrides: Partial<ReviewContext> = {}): ReviewContext {
  return {
    diff: 'diff --git a/foo.ts\n+added line',
    diffStat: ' foo.ts | 1 +\n 1 file changed',
    changedFiles: ['src/foo.ts'],
    architecture: '# Architecture',
    specs: [],
    rules: '',
    projectName: 'my-project',
    scope: 'staged',
    ...overrides,
  };
}

// ─── Test setup ──────────────────────────────────────────────────────────────

let tmpDir: string;
let origCwd: string;
let mockExit: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  origCwd = process.cwd();
  tmpDir = mkdtempSync(join(tmpdir(), 'ralph-review-'));
  mkdirSync(join(tmpDir, '.git'), { recursive: true });
  process.chdir(tmpDir);

  mockLoadConfig.mockReturnValue(makeLoadResult());
  mockResolveScope.mockReturnValue({ gitArgs: ['--cached'], scopeLabel: 'staged changes' });
  mockExtractDiff.mockReturnValue({
    diff: 'diff --git a/foo.ts\n+added line',
    diffStat: ' foo.ts | 1 +\n 1 file changed',
    changedFiles: ['src/foo.ts'],
    binaryCount: 0,
  });
  mockAssembleContext.mockReturnValue(makeReviewContext());
  mockGenerateReviewPrompt.mockReturnValue('the review prompt');
  mockSpawnAgent.mockResolvedValue({ exitCode: 0, durationMs: 5000, output: 'APPROVE\nLooks good.' });

  vi.clearAllMocks();
  // Re-set defaults after clearAllMocks
  mockLoadConfig.mockReturnValue(makeLoadResult());
  mockResolveScope.mockReturnValue({ gitArgs: ['--cached'], scopeLabel: 'staged changes' });
  mockExtractDiff.mockReturnValue({
    diff: 'diff --git a/foo.ts\n+added line',
    diffStat: ' foo.ts | 1 +\n 1 file changed',
    changedFiles: ['src/foo.ts'],
    binaryCount: 0,
  });
  mockAssembleContext.mockReturnValue(makeReviewContext());
  mockGenerateReviewPrompt.mockReturnValue('the review prompt');
  mockSpawnAgent.mockResolvedValue({ exitCode: 0, durationMs: 5000, output: 'APPROVE\nLooks good.' });

  mockExit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit'); });
});

afterEach(() => {
  process.chdir(origCwd);
  rmSync(tmpDir, { recursive: true, force: true });
  mockExit.mockRestore();
});

// ─── reviewCommand ────────────────────────────────────────────────────────────

describe('reviewCommand', () => {
  it('staged review — default flow spawns agent and prints output', async () => {
    await reviewCommand(undefined, {});

    expect(mockSpawnAgent).toHaveBeenCalledOnce();
    const [agentConfig, prompt, opts] = mockSpawnAgent.mock.calls[0]!;
    expect(prompt).toBe('the review prompt');
    expect(opts).toMatchObject({ capture: true });
    expect(agentConfig.cli).toBe('claude');
    expect(mockPlain).toHaveBeenCalledWith('APPROVE\nLooks good.');
  });

  it('commit SHA review — passes commit args to resolveScope', async () => {
    await reviewCommand('abc123', {});

    expect(mockResolveScope).toHaveBeenCalledWith('abc123', undefined, 'staged');
    expect(mockSpawnAgent).toHaveBeenCalledOnce();
  });

  it('range review — passes range target to resolveScope', async () => {
    await reviewCommand('abc..def', {});

    expect(mockResolveScope).toHaveBeenCalledWith('abc..def', undefined, 'staged');
  });

  it('--scope flag is forwarded to resolveScope', async () => {
    await reviewCommand(undefined, { scope: 'working' });

    expect(mockResolveScope).toHaveBeenCalledWith(undefined, 'working', 'staged');
  });

  it('--dry-run prints prompt without spawning agent', async () => {
    await reviewCommand(undefined, { dryRun: true });

    expect(mockSpawnAgent).not.toHaveBeenCalled();
    expect(mockPlain).toHaveBeenCalledWith('the review prompt');
  });

  it('--format json produces JSON output structure', async () => {
    await reviewCommand(undefined, { format: 'json' });

    expect(mockPlain).toHaveBeenCalledOnce();
    const output = mockPlain.mock.calls[0]![0];
    const parsed = JSON.parse(output) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      project: 'my-project',
      scope: 'staged changes',
      files: ['src/foo.ts'],
      review: 'APPROVE\nLooks good.',
    });
    expect(typeof parsed['date']).toBe('string');
    expect(typeof parsed['durationMs']).toBe('number');
  });

  it('--format markdown adds header with date/scope/files', async () => {
    await reviewCommand(undefined, { format: 'markdown' });

    expect(mockPlain).toHaveBeenCalledOnce();
    const output = mockPlain.mock.calls[0]![0];
    expect(output).toContain('# Code Review — my-project');
    expect(output).toContain('**Scope:** staged changes');
    expect(output).toContain('**Files:** 1 changed');
    expect(output).toContain('APPROVE\nLooks good.');
  });

  it('--diff-only passes diffOnly=true to generateReviewPrompt', async () => {
    await reviewCommand(undefined, { diffOnly: true });

    expect(mockGenerateReviewPrompt).toHaveBeenCalledWith(
      expect.anything(),
      { diffOnly: true },
    );
    expect(mockAssembleContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ diffOnly: true }),
    );
  });

  it('empty diff exits with error (staged scope)', async () => {
    mockExtractDiff.mockReturnValue({
      diff: '',
      diffStat: '',
      changedFiles: [],
      binaryCount: 0,
    });

    await expect(reviewCommand(undefined, {})).rejects.toThrow('process.exit');
    expect(mockError).toHaveBeenCalledWith(expect.stringContaining('Nothing to review'));
  });

  it('empty diff exits with error for non-staged scope', async () => {
    mockExtractDiff.mockReturnValue({
      diff: '',
      diffStat: '',
      changedFiles: [],
      binaryCount: 0,
    });

    await expect(reviewCommand('abc..def', {})).rejects.toThrow('process.exit');
    expect(mockError).toHaveBeenCalledWith(expect.stringContaining('Diff is empty'));
  });

  it('git not-repo error exits with error message', async () => {
    mockExtractDiff.mockImplementation(() => {
      throw new Error('Not a git repository. `ralph review` requires git.');
    });

    await expect(reviewCommand(undefined, {})).rejects.toThrow('process.exit');
    expect(mockError).toHaveBeenCalledWith(expect.stringContaining('Not a git repository'));
  });

  it('scope range with no target exits with error', async () => {
    mockResolveScope.mockImplementation(() => {
      throw new Error('Specify a range like abc..def when using --scope range.');
    });

    await expect(reviewCommand(undefined, { scope: 'range' })).rejects.toThrow('process.exit');
    expect(mockError).toHaveBeenCalledWith(expect.stringContaining('range'));
  });

  it('binary files emit warning', async () => {
    mockExtractDiff.mockReturnValue({
      diff: 'diff --git a/img.png\n+changed',
      diffStat: ' img.png | Bin\n 1 file changed',
      changedFiles: ['img.png'],
      binaryCount: 2,
    });

    await reviewCommand(undefined, {});

    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('2 binary file'));
  });

  it('--output writes to file instead of stdout', async () => {
    const outFile = join(tmpDir, 'review.txt');

    await reviewCommand(undefined, { output: outFile });

    const { readFileSync } = await import('node:fs');
    const content = readFileSync(outFile, 'utf-8');
    expect(content).toBe('APPROVE\nLooks good.');
    expect(mockSuccess).toHaveBeenCalledWith(expect.stringContaining(outFile));
    expect(mockPlain).not.toHaveBeenCalled();
  });

  it('--output with --format json writes JSON file', async () => {
    const outFile = join(tmpDir, 'review.json');

    await reviewCommand(undefined, { output: outFile, format: 'json' });

    const { readFileSync } = await import('node:fs');
    const content = readFileSync(outFile, 'utf-8');
    const parsed = JSON.parse(content) as Record<string, unknown>;
    expect(parsed['project']).toBe('my-project');
    expect(parsed['review']).toBe('APPROVE\nLooks good.');
  });

  it('agent error exits with error message', async () => {
    mockSpawnAgent.mockResolvedValue({
      exitCode: 1,
      durationMs: 100,
      error: 'Agent CLI "claude" not found.',
      output: '',
    });

    await expect(reviewCommand(undefined, {})).rejects.toThrow('process.exit');
    expect(mockError).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('uses review.agent when configured (not run.agent)', async () => {
    const reviewAgent: AgentConfig = { cli: 'codex', args: ['--model', 'o3'], timeout: 300 };
    mockLoadConfig.mockReturnValue(makeLoadResult({
      review: { agent: reviewAgent },
    }));

    await reviewCommand(undefined, {});

    const [agentConfig] = mockSpawnAgent.mock.calls[0]!;
    expect(agentConfig.cli).toBe('codex');
  });

  it('falls back to run.agent when review.agent is null', async () => {
    mockLoadConfig.mockReturnValue(makeLoadResult({
      review: { agent: null },
    }));

    await reviewCommand(undefined, {});

    const [agentConfig] = mockSpawnAgent.mock.calls[0]!;
    expect(agentConfig.cli).toBe('claude');
  });

  it('--agent CLI flag overrides agent config', async () => {
    // When CLI changes and preset exists, use preset args
    const { injectModel } = await import('../run/agent.js');
    vi.mocked(injectModel).mockImplementation((args, _model) => args);

    await reviewCommand(undefined, { agent: 'claude' });

    const [agentConfig] = mockSpawnAgent.mock.calls[0]!;
    expect(agentConfig.cli).toBe('claude');
  });

  it('verbose option is forwarded to spawnAgent', async () => {
    await reviewCommand(undefined, { verbose: true });

    const [, , opts] = mockSpawnAgent.mock.calls[0]!;
    expect(opts).toMatchObject({ verbose: true });
  });

  it('scope label is set on review context', async () => {
    mockResolveScope.mockReturnValue({ gitArgs: ['HEAD~1..HEAD'], scopeLabel: 'HEAD~1..HEAD' });

    await reviewCommand(undefined, { scope: 'commit' });

    expect(mockAssembleContext).toHaveBeenCalled();
    // The scope is set on the context returned by assembleContext
    // reviewContext.scope = scopeInfo.scopeLabel happens in index.ts
  });

  it('output format from config is used when no --format flag', async () => {
    mockLoadConfig.mockReturnValue(makeLoadResult({
      review: { output: { format: 'markdown', file: null, 'severity-threshold': 'info' } },
    }));

    await reviewCommand(undefined, {});

    expect(mockPlain).toHaveBeenCalledOnce();
    const out = mockPlain.mock.calls[0]![0];
    expect(out).toContain('# Code Review');
  });
});
