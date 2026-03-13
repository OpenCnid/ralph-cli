import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, rmSync } from 'node:fs';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../src/config/loader.js', () => ({
  loadConfig: vi.fn(),
}));

vi.mock('../src/commands/run/agent.js', () => ({
  spawnAgent: vi.fn(),
  injectModel: vi.fn((args: string[], model: string) => [...args, '--model', model]),
  AGENT_PRESETS: {
    claude: { args: ['--print', '--dangerously-skip-permissions'], timeout: 600 },
  },
}));

vi.mock('../src/commands/review/context.js', () => ({
  resolveScope: vi.fn(),
  extractDiff: vi.fn(),
  assembleContext: vi.fn(),
}));

vi.mock('../src/commands/review/prompts.js', () => ({
  generateReviewPrompt: vi.fn(),
}));

vi.mock('../src/utils/output.js', () => ({
  plain: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
  heading: vi.fn(),
}));

// ─── Imports after mocks ─────────────────────────────────────────────────────

import { loadConfig } from '../src/config/loader.js';
import { spawnAgent } from '../src/commands/run/agent.js';
import { resolveScope, extractDiff, assembleContext } from '../src/commands/review/context.js';
import { generateReviewPrompt } from '../src/commands/review/prompts.js';
import * as outputMod from '../src/utils/output.js';
import { reviewCommand } from '../src/commands/review/index.js';
import type { RalphConfig } from '../src/config/schema.js';
import type { LoadResult } from '../src/config/loader.js';

const mockLoadConfig = vi.mocked(loadConfig);
const mockSpawnAgent = vi.mocked(spawnAgent);
const mockResolveScope = vi.mocked(resolveScope);
const mockExtractDiff = vi.mocked(extractDiff);
const mockAssembleContext = vi.mocked(assembleContext);
const mockGenerateReviewPrompt = vi.mocked(generateReviewPrompt);
const mockPlain = vi.mocked(outputMod.plain);
const mockError = vi.mocked(outputMod.error);
const mockWarn = vi.mocked(outputMod.warn);
const mockSuccess = vi.mocked(outputMod.success);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<RalphConfig> = {}): RalphConfig {
  return {
    project: { name: 'test-project', language: 'typescript' },
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
    run: {
      agent: { cli: 'claude', args: ['--print'], timeout: 600 },
      'plan-agent': null,
      'build-agent': null,
      prompts: { plan: null, build: null },
      loop: { 'max-iterations': 10, 'stall-threshold': 3 },
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
    ...overrides,
  };
}

function makeLoadResult(configOverrides: Partial<RalphConfig> = {}): LoadResult {
  return { config: makeConfig(configOverrides), configPath: '.ralph/config.yml', warnings: [] };
}

function makeDiffResult(overrides: Partial<{ diff: string; diffStat: string; changedFiles: string[]; binaryCount: number }> = {}) {
  return {
    diff: 'diff content\nsome change',
    diffStat: ' src/foo.ts | 1 +\n 1 file changed',
    changedFiles: ['src/foo.ts'],
    binaryCount: 0,
    ...overrides,
  };
}

function makeReviewContext(overrides: Record<string, unknown> = {}) {
  return {
    diff: 'diff content\nsome change',
    diffStat: ' src/foo.ts | 1 +\n 1 file changed',
    changedFiles: ['src/foo.ts'],
    architecture: '# Architecture',
    specs: [],
    rules: '',
    projectName: 'test-project',
    scope: 'staged changes',
    ...overrides,
  };
}

// ─── Setup ───────────────────────────────────────────────────────────────────

let mockExit: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();

  mockExit = vi.spyOn(process, 'exit').mockImplementation((_code?: string | number | null) => {
    throw new Error(`process.exit(${_code})`);
  }) as ReturnType<typeof vi.spyOn>;

  mockLoadConfig.mockReturnValue(makeLoadResult());
  mockResolveScope.mockReturnValue({ gitArgs: ['--cached'], scopeLabel: 'staged changes' });
  mockExtractDiff.mockReturnValue(makeDiffResult());
  mockAssembleContext.mockReturnValue(makeReviewContext());
  mockGenerateReviewPrompt.mockReturnValue('generated review prompt');
  mockSpawnAgent.mockResolvedValue({ exitCode: 0, durationMs: 100, output: 'agent review text' });
});

afterEach(() => {
  mockExit.mockRestore();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('reviewCommand', () => {
  it('staged review: calls spawnAgent and prints text output', async () => {
    await reviewCommand(undefined, {});
    expect(mockSpawnAgent).toHaveBeenCalledOnce();
    expect(mockPlain).toHaveBeenCalledWith('agent review text');
  });

  it('commit SHA review: passes target to resolveScope', async () => {
    mockResolveScope.mockReturnValue({ gitArgs: ['HEAD~1..HEAD'], scopeLabel: 'HEAD' });
    await reviewCommand('HEAD', {});
    expect(mockResolveScope).toHaveBeenCalledWith('HEAD', undefined, 'staged');
  });

  it('range review: passes range target to resolveScope', async () => {
    mockResolveScope.mockReturnValue({ gitArgs: ['abc..def'], scopeLabel: 'abc..def' });
    await reviewCommand('abc..def', {});
    expect(mockResolveScope).toHaveBeenCalledWith('abc..def', undefined, 'staged');
  });

  it('--dry-run prints prompt without spawning agent', async () => {
    await reviewCommand(undefined, { dryRun: true });
    expect(mockSpawnAgent).not.toHaveBeenCalled();
    expect(mockPlain).toHaveBeenCalledWith('generated review prompt');
  });

  it('--format json produces JSON structure', async () => {
    await reviewCommand(undefined, { format: 'json' });
    expect(mockPlain).toHaveBeenCalledOnce();
    const plainArg = mockPlain.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(plainArg) as Record<string, unknown>;
    expect(parsed.project).toBe('test-project');
    expect(parsed.scope).toBe('staged changes');
    expect(parsed.files).toEqual(['src/foo.ts']);
    expect(parsed.review).toBe('agent review text');
    expect(parsed).toHaveProperty('durationMs');
  });

  it('--format markdown adds header with project name and scope', async () => {
    await reviewCommand(undefined, { format: 'markdown' });
    const plainArg = mockPlain.mock.calls[0]?.[0] as string;
    expect(plainArg).toContain('# Code Review — test-project');
    expect(plainArg).toContain('staged changes');
    expect(plainArg).toContain('agent review text');
  });

  it('--diff-only calls generateReviewPrompt with diffOnly=true', async () => {
    await reviewCommand(undefined, { diffOnly: true });
    expect(mockGenerateReviewPrompt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ diffOnly: true }),
    );
    expect(mockAssembleContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ diffOnly: true }),
    );
  });

  it('no staged changes: prints error and exits', async () => {
    mockExtractDiff.mockReturnValue(makeDiffResult({ diff: '', diffStat: '' }));
    await expect(reviewCommand(undefined, {})).rejects.toThrow('process.exit(1)');
    expect(mockError).toHaveBeenCalled();
  });

  it('--scope range with no target: prints error and exits', async () => {
    mockResolveScope.mockImplementation(() => {
      throw new Error('Specify a range like abc..def');
    });
    await expect(reviewCommand(undefined, { scope: 'range' })).rejects.toThrow('process.exit(1)');
    expect(mockError).toHaveBeenCalledWith(expect.stringContaining('range'));
  });

  it('not-a-git-repo error: prints error and exits', async () => {
    mockExtractDiff.mockImplementation(() => {
      throw new Error('Not a git repository');
    });
    await expect(reviewCommand(undefined, {})).rejects.toThrow('process.exit(1)');
    expect(mockError).toHaveBeenCalledWith(expect.stringContaining('git repository'));
  });

  it('agent spawn error: prints error and exits', async () => {
    mockSpawnAgent.mockResolvedValue({ exitCode: 1, durationMs: 50, error: 'Agent CLI "x" not found' });
    await expect(reviewCommand(undefined, {})).rejects.toThrow('process.exit(1)');
    expect(mockError).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('binary files emits skipped warning', async () => {
    mockExtractDiff.mockReturnValue(makeDiffResult({ binaryCount: 2 }));
    await reviewCommand(undefined, {});
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('binary'));
  });

  it('--output writes review to file and reports success', async () => {
    const outputPath = join(tmpdir(), `review-test-${Date.now()}.txt`);
    try {
      await reviewCommand(undefined, { output: outputPath });
      expect(existsSync(outputPath)).toBe(true);
      expect(mockSuccess).toHaveBeenCalledWith(expect.stringContaining(outputPath));
    } finally {
      rmSync(outputPath, { force: true });
    }
  });

  it('large diff: assembleContext called with correct maxDiffLines', async () => {
    await reviewCommand(undefined, {});
    expect(mockAssembleContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ maxDiffLines: 2000 }),
    );
  });
});
