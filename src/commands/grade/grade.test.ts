import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
});
