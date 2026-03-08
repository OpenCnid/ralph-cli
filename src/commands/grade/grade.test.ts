import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { scoreProject } from './index.js';
import type { RalphConfig } from '../../config/schema.js';
import { mergeWithDefaults } from '../../config/loader.js';

function makeTempDir(): string {
  const dir = join(tmpdir(), `ralph-grade-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeConfig(overrides?: Partial<{ name: string; language: string }>): RalphConfig {
  return mergeWithDefaults({
    project: {
      name: overrides?.name ?? 'test-project',
      language: (overrides?.language ?? 'typescript') as 'typescript',
    },
  });
}

function initGitRepo(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
}

describe('scoreProject', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    mkdirSync(join(tempDir, '.git'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('scores a bare repo with no docs or coverage', () => {
    const config = makeConfig();
    const score = scoreProject(tempDir, config);

    expect(score.domain).toBe('test-project');
    expect(score.docs.grade).toBe('F'); // no docs
    expect(score.tests.grade).toBe('C'); // no coverage tool = C default
    expect(score.staleness).toBeDefined();
    expect(score.overall).toBeDefined();
  });

  it('scores docs higher when files are present', () => {
    const config = makeConfig();

    // Create docs
    mkdirSync(join(tempDir, 'docs', 'design-docs'), { recursive: true });
    writeFileSync(join(tempDir, 'AGENTS.md'), '# Agents\n');
    writeFileSync(join(tempDir, 'ARCHITECTURE.md'), '# Arch\n');
    writeFileSync(join(tempDir, 'docs', 'design-docs', 'core-beliefs.md'), '# Beliefs\n');
    writeFileSync(join(tempDir, 'docs', 'DESIGN.md'), '# Design\n');
    writeFileSync(join(tempDir, 'docs', 'QUALITY_SCORE.md'), '# Quality\n');

    const score = scoreProject(tempDir, config);
    expect(score.docs.grade).toBe('A'); // all 5 docs present
  });

  it('scores architecture A when no violations exist', () => {
    const config = makeConfig();
    writeFileSync(join(tempDir, 'clean.ts'), 'export const x = 1;\n');

    const score = scoreProject(tempDir, config);
    expect(score.architecture.grade).toBe('A');
  });

  it('scores file health A when no oversized files', () => {
    const config = makeConfig();
    writeFileSync(join(tempDir, 'small.ts'), Array(50).fill('// line').join('\n'));

    const score = scoreProject(tempDir, config);
    expect(score.fileHealth.grade).toBe('A');
  });

  it('overall grade is the weakest dimension', () => {
    const config = makeConfig();
    // No docs = F docs grade, so overall should be F
    const score = scoreProject(tempDir, config);
    expect(score.overall).toBe('F');
  });

  it('includes staleness dimension in scoring', () => {
    const config = makeConfig();
    const score = scoreProject(tempDir, config);

    expect(score.staleness).toBeDefined();
    expect(score.staleness.grade).toBeDefined();
    expect(score.staleness.detail).toBeDefined();
    // With no source files, staleness should be A
    expect(score.staleness.grade).toBe('A');
    expect(score.staleness.detail).toContain('No source files');
  });

  it('staleness grades recently committed files as A', () => {
    initGitRepo(tempDir);
    writeFileSync(join(tempDir, 'app.ts'), 'export const x = 1;\n');
    execSync('git add -A && git commit -m "init"', { cwd: tempDir, stdio: 'pipe' });

    const config = makeConfig();
    const score = scoreProject(tempDir, config);

    expect(score.staleness.grade).toBe('A');
    expect(score.staleness.detail).toContain('Median');
  });

  it('staleness returns C when no git history is available', () => {
    // .git stub dir exists but no real git repo — git log will fail
    writeFileSync(join(tempDir, 'app.ts'), 'export const x = 1;\n');

    const config = makeConfig();
    const score = scoreProject(tempDir, config);

    expect(score.staleness.grade).toBe('C');
    expect(score.staleness.detail).toContain('No git history');
  });

  it('overall includes staleness in weakest-link calculation', () => {
    const config = makeConfig();

    // Create all docs so docs dimension is A
    mkdirSync(join(tempDir, 'docs', 'design-docs'), { recursive: true });
    writeFileSync(join(tempDir, 'AGENTS.md'), '# Agents\n');
    writeFileSync(join(tempDir, 'ARCHITECTURE.md'), '# Arch\n');
    writeFileSync(join(tempDir, 'docs', 'design-docs', 'core-beliefs.md'), '# Beliefs\n');
    writeFileSync(join(tempDir, 'docs', 'DESIGN.md'), '# Design\n');
    writeFileSync(join(tempDir, 'docs', 'QUALITY_SCORE.md'), '# Quality\n');

    const score = scoreProject(tempDir, config);
    // Overall should factor in all five dimensions including staleness
    const allGrades = [score.tests.grade, score.docs.grade, score.architecture.grade, score.fileHealth.grade, score.staleness.grade];
    const gradeOrder = ['A', 'B', 'C', 'D', 'F'];
    const worstIdx = Math.max(...allGrades.map(g => gradeOrder.indexOf(g)));
    expect(score.overall).toBe(gradeOrder[worstIdx]);
  });
});

describe('DomainScore structure', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    mkdirSync(join(tempDir, '.git'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('has all five dimensions plus overall', () => {
    const config = makeConfig();
    const score = scoreProject(tempDir, config);

    expect(score).toHaveProperty('tests');
    expect(score).toHaveProperty('docs');
    expect(score).toHaveProperty('architecture');
    expect(score).toHaveProperty('fileHealth');
    expect(score).toHaveProperty('staleness');
    expect(score).toHaveProperty('overall');
  });
});
