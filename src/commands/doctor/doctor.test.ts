import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runAllChecks } from './index.js';
import type { RalphConfig } from '../../config/schema.js';
import { mergeWithDefaults } from '../../config/loader.js';

function makeTempDir(): string {
  const dir = join(tmpdir(), `ralph-doctor-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeConfig(): RalphConfig {
  return mergeWithDefaults({
    project: { name: 'test-project', language: 'typescript' as const },
  });
}

describe('doctor checks', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    mkdirSync(join(tempDir, '.git'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('reports missing AGENTS.md', () => {
    const checks = runAllChecks(tempDir, makeConfig());
    const agentsCheck = checks.find(c => c.name.includes('AGENTS.md exists'));
    expect(agentsCheck).toBeDefined();
    expect(agentsCheck!.pass).toBe(false);
    expect(agentsCheck!.fix).toContain('ralph init');
  });

  it('passes AGENTS.md check when present and under 100 lines', () => {
    writeFileSync(join(tempDir, 'AGENTS.md'), '# Agents\n## Build\n## Test\n## Lint\n');
    const checks = runAllChecks(tempDir, makeConfig());
    const agentsCheck = checks.find(c => c.name.includes('AGENTS.md'));
    expect(agentsCheck!.pass).toBe(true);
  });

  it('detects missing .ralph/config.yml', () => {
    const checks = runAllChecks(tempDir, makeConfig());
    const configCheck = checks.find(c => c.name.includes('config.yml'));
    expect(configCheck).toBeDefined();
    expect(configCheck!.pass).toBe(false);
  });

  it('passes config check when present', () => {
    mkdirSync(join(tempDir, '.ralph'), { recursive: true });
    writeFileSync(join(tempDir, '.ralph', 'config.yml'), 'project:\n  name: test\n  language: typescript\n');
    const checks = runAllChecks(tempDir, makeConfig());
    const configCheck = checks.find(c => c.name.includes('config.yml'));
    expect(configCheck!.pass).toBe(true);
  });

  it('detects LLM references in AGENTS.md', () => {
    writeFileSync(join(tempDir, 'AGENTS.md'), '# Agents\nUse openai GPT-4 for this project\n## Build\n## Test\n## Lint\n');
    const checks = runAllChecks(tempDir, makeConfig());
    const llmCheck = checks.find(c => c.name.includes('LLM'));
    expect(llmCheck).toBeDefined();
    expect(llmCheck!.pass).toBe(false);
  });

  it('checks for build/test/lint commands in AGENTS.md', () => {
    writeFileSync(join(tempDir, 'AGENTS.md'), '# Agents\n## Commands\n- build: npm run build\n- test: npm test\n- lint: npm run lint\n');
    const checks = runAllChecks(tempDir, makeConfig());
    const cmdCheck = checks.find(c => c.name.includes('build/test/lint'));
    expect(cmdCheck!.pass).toBe(true);
  });

  it('detects test runner from package.json', () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      devDependencies: { vitest: '^1.0.0', eslint: '^8.0.0', typescript: '^5.0.0' },
    }));
    const checks = runAllChecks(tempDir, makeConfig());
    const testCheck = checks.find(c => c.name === 'Test runner configured');
    expect(testCheck!.pass).toBe(true);
    const lintCheck = checks.find(c => c.name === 'Linter configured');
    expect(lintCheck!.pass).toBe(true);
    const typeCheck = checks.find(c => c.name === 'Type checker configured');
    expect(typeCheck!.pass).toBe(true);
  });

  it('checks git repo presence', () => {
    const checks = runAllChecks(tempDir, makeConfig());
    const gitCheck = checks.find(c => c.name === 'Git repository');
    expect(gitCheck!.pass).toBe(true);
  });

  it('checks .gitignore presence', () => {
    writeFileSync(join(tempDir, '.gitignore'), 'dist/\nnode_modules/\n');
    const checks = runAllChecks(tempDir, makeConfig());
    const gitignoreCheck = checks.find(c => c.name === '.gitignore exists');
    expect(gitignoreCheck!.pass).toBe(true);
    const buildCheck = checks.find(c => c.name.includes('Build artifacts'));
    expect(buildCheck!.pass).toBe(true);
  });

  it('every failing check has a fix recommendation', () => {
    const checks = runAllChecks(tempDir, makeConfig());
    const failing = checks.filter(c => !c.pass);
    for (const check of failing) {
      expect(check.fix).toBeDefined();
      expect(check.fix!.length).toBeGreaterThan(0);
    }
  });

  it('all checks have a category', () => {
    const checks = runAllChecks(tempDir, makeConfig());
    const validCategories = ['structure', 'content', 'backpressure', 'operational'];
    for (const check of checks) {
      expect(validCategories).toContain(check.category);
    }
  });

  it('detects test files exist', () => {
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'app.test.ts'), 'test("works", () => {});\n');
    const checks = runAllChecks(tempDir, makeConfig());
    const testFilesCheck = checks.find(c => c.name === 'Test files exist');
    expect(testFilesCheck).toBeDefined();
    expect(testFilesCheck!.pass).toBe(true);
  });

  it('fails test files check when no test files present', () => {
    const checks = runAllChecks(tempDir, makeConfig());
    const testFilesCheck = checks.find(c => c.name === 'Test files exist');
    expect(testFilesCheck).toBeDefined();
    expect(testFilesCheck!.pass).toBe(false);
    expect(testFilesCheck!.fix).toContain('test files');
  });

  it('detects Go test files', () => {
    mkdirSync(join(tempDir, 'pkg'), { recursive: true });
    writeFileSync(join(tempDir, 'pkg', 'handler_test.go'), 'package pkg\n');
    const checks = runAllChecks(tempDir, makeConfig());
    const testFilesCheck = checks.find(c => c.name === 'Test files exist');
    expect(testFilesCheck!.pass).toBe(true);
  });

  it('detects Python test files', () => {
    mkdirSync(join(tempDir, 'tests'), { recursive: true });
    writeFileSync(join(tempDir, 'tests', 'test_auth.py'), 'def test_login(): pass\n');
    const checks = runAllChecks(tempDir, makeConfig());
    const testFilesCheck = checks.find(c => c.name === 'Test files exist');
    expect(testFilesCheck!.pass).toBe(true);
  });

  it('fully initialized repo passes most checks', () => {
    // Set up a fully initialized structure
    mkdirSync(join(tempDir, '.ralph', 'rules'), { recursive: true });
    mkdirSync(join(tempDir, 'docs', 'design-docs'), { recursive: true });
    mkdirSync(join(tempDir, 'docs', 'product-specs'), { recursive: true });
    mkdirSync(join(tempDir, 'docs', 'exec-plans', 'active'), { recursive: true });
    mkdirSync(join(tempDir, 'docs', 'exec-plans', 'completed'), { recursive: true });
    mkdirSync(join(tempDir, 'docs', 'references'), { recursive: true });
    mkdirSync(join(tempDir, 'docs', 'generated'), { recursive: true });

    writeFileSync(join(tempDir, 'AGENTS.md'), `<!-- Generated by ralph-cli. Edit freely. -->
# test-project
## Commands
- Build: \`npm run build\`
- Test: \`npm test\`
- Lint: \`npm run lint\`
## Structure
## Documentation
## References
`);
    writeFileSync(join(tempDir, 'ARCHITECTURE.md'), '# Architecture\n## Domains\n## Layers\n');
    writeFileSync(join(tempDir, 'docs', 'DESIGN.md'), '# Design\n');
    writeFileSync(join(tempDir, 'docs', 'RELIABILITY.md'), '# Reliability\n');
    writeFileSync(join(tempDir, 'docs', 'SECURITY.md'), '# Security\n');
    writeFileSync(join(tempDir, 'docs', 'QUALITY_SCORE.md'), '# Quality\n');
    writeFileSync(join(tempDir, 'docs', 'design-docs', 'core-beliefs.md'), '# Core Beliefs\n1. First\n2. Second\n3. Third\n');
    writeFileSync(join(tempDir, 'docs', 'exec-plans', 'tech-debt-tracker.md'), '# Tech Debt\n');
    writeFileSync(join(tempDir, '.ralph', 'config.yml'), 'project:\n  name: test\n  language: typescript\n');
    writeFileSync(join(tempDir, '.gitignore'), 'dist/\nnode_modules/\n');
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      devDependencies: { typescript: '^5.0.0', vitest: '^1.0.0', eslint: '^8.0.0' },
    }));

    // Add a test file so the "test files exist" check passes
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'app.test.ts'), 'test("works", () => {});\n');

    const checks = runAllChecks(tempDir, makeConfig());
    const passing = checks.filter(c => c.pass).length;
    const total = checks.length;
    // Expect high pass rate for fully initialized repo
    expect(passing / total).toBeGreaterThanOrEqual(0.9);
  });
});
