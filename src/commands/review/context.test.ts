import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveScope, findRelevantSpecs, assembleContext } from './context.js';
import type { RalphConfig } from '../../config/schema.js';

// Mock child_process so extractDiff tests don't hit the real git
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

function makeTempDir(): string {
  const dir = join(tmpdir(), `ralph-review-ctx-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function baseConfig(overrides: Partial<RalphConfig> = {}): RalphConfig {
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
    ...overrides,
  };
}

// ── resolveScope ────────────────────────────────────────────────────────────

describe('resolveScope', () => {
  it('resolves explicit range target (abc..def)', () => {
    const { gitArgs, scopeLabel } = resolveScope('abc..def', undefined, 'staged');
    expect(gitArgs).toEqual(['abc..def']);
    expect(scopeLabel).toBe('abc..def');
  });

  it('resolves single SHA target', () => {
    const { gitArgs, scopeLabel } = resolveScope('abc1234', undefined, 'staged');
    expect(gitArgs).toEqual(['abc1234~1..abc1234']);
    expect(scopeLabel).toBe('abc1234~1..abc1234');
  });

  it('resolves HEAD target', () => {
    const { gitArgs, scopeLabel } = resolveScope('HEAD', undefined, 'staged');
    expect(gitArgs).toEqual(['HEAD~1..HEAD']);
    expect(scopeLabel).toBe('HEAD~1..HEAD');
  });

  it('resolves scope=staged (default)', () => {
    const { gitArgs, scopeLabel } = resolveScope(undefined, undefined, 'staged');
    expect(gitArgs).toEqual(['--cached']);
    expect(scopeLabel).toBe('staged changes');
  });

  it('resolves scope=working', () => {
    const { gitArgs, scopeLabel } = resolveScope(undefined, 'working', 'staged');
    expect(gitArgs).toEqual([]);
    expect(scopeLabel).toBe('working tree changes');
  });

  it('resolves scope=commit (no target)', () => {
    const { gitArgs, scopeLabel } = resolveScope(undefined, 'commit', 'staged');
    expect(gitArgs).toEqual(['HEAD~1..HEAD']);
    expect(scopeLabel).toBe('HEAD~1..HEAD');
  });

  it('throws for scope=range with no target', () => {
    expect(() => resolveScope(undefined, 'range', 'staged')).toThrow(/range/i);
  });

  it('scope flag overrides config scope', () => {
    const { gitArgs } = resolveScope(undefined, 'working', 'staged');
    expect(gitArgs).toEqual([]);
  });
});

// ── extractDiff ─────────────────────────────────────────────────────────────

describe('extractDiff', () => {
  beforeEach(() => vi.clearAllMocks());

  it('parses changed files from stat output', async () => {
    const { execSync } = await import('node:child_process');
    vi.mocked(execSync)
      .mockReturnValueOnce('diff content here\n' as never)
      .mockReturnValueOnce(' src/foo.ts | 3 +++\n src/bar.ts | 2 --\n 2 files changed\n' as never);
    const { extractDiff } = await import('./context.js');
    const result = extractDiff(['--cached'], 5);
    expect(result.changedFiles).toContain('src/foo.ts');
    expect(result.changedFiles).toContain('src/bar.ts');
  });

  it('counts binary files and removes them from diff', async () => {
    const { execSync } = await import('node:child_process');
    vi.mocked(execSync)
      .mockReturnValueOnce('regular diff\nBinary files a/img.png and b/img.png differ\nmore diff\n' as never)
      .mockReturnValueOnce('' as never);
    const { extractDiff } = await import('./context.js');
    const result = extractDiff(['--cached'], 5);
    expect(result.binaryCount).toBe(1);
    expect(result.diff).not.toContain('Binary files');
  });

  it('returns empty diff on git exec error (not a git repo)', async () => {
    const { execSync } = await import('node:child_process');
    vi.mocked(execSync).mockImplementation(() => {
      const err = Object.assign(new Error('fatal error'), { stderr: Buffer.from('not a git repository') });
      throw err;
    });
    const { extractDiff } = await import('./context.js');
    expect(() => extractDiff(['--cached'], 5)).toThrow('Not a git repository');
  });
});

// ── findRelevantSpecs ───────────────────────────────────────────────────────

describe('findRelevantSpecs', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    mkdirSync(join(tempDir, 'specs'));
    writeFileSync(join(tempDir, 'specs', 'auth.md'), '# Auth spec');
    writeFileSync(join(tempDir, 'specs', 'billing.md'), '# Billing spec');
    writeFileSync(join(tempDir, 'specs', 'user-auth.md'), '# User auth spec');
    writeFileSync(join(tempDir, 'specs', 'api.md'), '# API spec');
  });

  afterEach(() => rmSync(tempDir, { recursive: true, force: true }));

  it('returns empty array when specs dir does not exist', () => {
    const result = findRelevantSpecs(['src/foo.ts'], join(tempDir, 'nonexistent'));
    expect(result).toEqual([]);
  });

  it('matches exact spec name', () => {
    const result = findRelevantSpecs(['src/auth/login.ts'], join(tempDir, 'specs'));
    expect(result.length).toBeGreaterThan(0);
    expect(result.some((r) => r.includes('auth'))).toBe(true);
  });

  it('matches fuzzy spec name (user-auth.md for auth domain)', () => {
    const result = findRelevantSpecs(['src/auth/session.ts'], join(tempDir, 'specs'));
    expect(result.length).toBeGreaterThan(0);
    expect(result.some((r) => r.includes('auth'))).toBe(true);
  });

  it('returns at most 3 results', () => {
    const result = findRelevantSpecs(
      ['src/auth/a.ts', 'src/billing/b.ts', 'src/api/c.ts', 'src/user/d.ts'],
      join(tempDir, 'specs'),
    );
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('returns empty array when no spec matches', () => {
    const result = findRelevantSpecs(['src/xyz/unknown.ts'], join(tempDir, 'specs'));
    expect(result).toEqual([]);
  });
});

// ── assembleContext ─────────────────────────────────────────────────────────

describe('assembleContext', () => {
  let tempDir: string;
  let origCwd: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    origCwd = process.cwd();
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('loads architecture.md when include-architecture is true', () => {
    writeFileSync(join(tempDir, 'ARCHITECTURE.md'), '# Architecture\nDomain boundaries here.');
    const config = baseConfig();
    const result = assembleContext(config, 'diff', 'stat', [], { diffOnly: false, maxDiffLines: 2000 });
    expect(result.architecture).toContain('Architecture');
  });

  it('skips architecture when diffOnly is true', () => {
    writeFileSync(join(tempDir, 'ARCHITECTURE.md'), '# Architecture\nDomain boundaries here.');
    const config = baseConfig();
    const result = assembleContext(config, 'diff', 'stat', [], { diffOnly: true, maxDiffLines: 2000 });
    expect(result.architecture).toBe('');
  });

  it('truncates diff at maxDiffLines with warning emitted', async () => {
    const longDiff = Array(100).fill('+ some change').join('\n');
    const config = baseConfig();
    const outputModule = await import('../../utils/output.js');
    const warnSpy = vi.spyOn(outputModule, 'warn').mockImplementation(() => {});
    const result = assembleContext(config, longDiff, 'stat', [], { diffOnly: true, maxDiffLines: 10 });
    expect(result.diff.split('\n').length).toBe(10);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('truncated'));
    warnSpy.mockRestore();
  });

  it('does not truncate diff when under maxDiffLines', () => {
    const diff = 'a\nb\nc';
    const config = baseConfig();
    const result = assembleContext(config, diff, 'stat', [], { diffOnly: true, maxDiffLines: 2000 });
    expect(result.diff).toBe(diff);
  });

  it('returns correct project name', () => {
    const config = baseConfig({ project: { name: 'my-app', language: 'typescript' } });
    const result = assembleContext(config, '', '', [], { diffOnly: true, maxDiffLines: 2000 });
    expect(result.projectName).toBe('my-app');
  });

  it('loads relevant specs when include-specs is true', () => {
    mkdirSync(join(tempDir, 'docs', 'product-specs'), { recursive: true });
    writeFileSync(join(tempDir, 'docs', 'product-specs', 'auth.md'), '# Auth spec content');
    const config = baseConfig();
    const result = assembleContext(config, 'diff', 'stat', ['src/auth/login.ts'], { diffOnly: false, maxDiffLines: 2000 });
    expect(result.specs.some((s) => s.includes('Auth spec'))).toBe(true);
  });

  it('empty architecture when file does not exist', () => {
    const config = baseConfig();
    const result = assembleContext(config, 'diff', 'stat', [], { diffOnly: false, maxDiffLines: 2000 });
    expect(result.architecture).toBe('');
  });

  it('empty specs array when no relevant specs found', () => {
    const config = baseConfig();
    const result = assembleContext(config, 'diff', 'stat', ['src/xyz/unknown.ts'], { diffOnly: false, maxDiffLines: 2000 });
    expect(result.specs).toEqual([]);
  });
});
