import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runAllChecks, doctorCommand } from './index.js';
import { doctorRuntime } from './checks.js';
import type { RalphConfig } from '../../config/schema.js';
import { mergeWithDefaults } from '../../config/loader.js';
import * as initModule from '../init/index.js';
import * as prompt from '../../utils/prompt.js';

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

let originalIsTtyDescriptor: PropertyDescriptor | undefined;

function setStdinIsTty(value: boolean): void {
  if (originalIsTtyDescriptor === undefined) {
    originalIsTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  }
  Object.defineProperty(process.stdin, 'isTTY', {
    configurable: true,
    value,
  });
}

function restoreStdinIsTty(): void {
  if (originalIsTtyDescriptor) {
    Object.defineProperty(process.stdin, 'isTTY', originalIsTtyDescriptor);
  }
}

describe('doctor checks', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    mkdirSync(join(tempDir, '.git'), { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    restoreStdinIsTty();
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

  it('runs tests and reports success when test command passes', () => {
    // Create package.json with a passing test script
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      scripts: { test: 'node -e "process.exit(0)"' },
      devDependencies: { vitest: '1.0.0' },
    }));
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'app.test.ts'), 'test("ok", () => {});\n');

    const execSyncSpy = vi.spyOn(doctorRuntime, 'execSync').mockImplementation((command: string) => {
      if (command === 'npm test') return Buffer.from('');
      if (command === 'git rev-list --count HEAD') return Buffer.from('1\n');
      throw new Error(`Unexpected execSync command: ${command}`);
    });

    const checks = runAllChecks(tempDir, makeConfig());
    const testRunCheck = checks.find(c => c.name === 'Tests run successfully');
    expect(testRunCheck).toBeDefined();
    expect(testRunCheck!.pass).toBe(true);
    expect(testRunCheck!.detail).toContain('exits 0');

    execSyncSpy.mockRestore();
  });

  it('runs tests and reports failure when test command fails', () => {
    // Create package.json with a failing test script
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      scripts: { test: 'node -e "process.exit(1)"' },
      devDependencies: { vitest: '1.0.0' },
    }));
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'app.test.ts'), 'test("ok", () => {});\n');

    const execSyncSpy = vi.spyOn(doctorRuntime, 'execSync').mockImplementation((command: string) => {
      if (command === 'git rev-list --count HEAD') return Buffer.from('1\n');
      if (command === 'npm test') {
        const err = new Error('npm test failed') as Error & { status?: number };
        err.status = 1;
        throw err;
      }
      throw new Error(`Unexpected execSync command: ${command}`);
    });

    const checks = runAllChecks(tempDir, makeConfig());
    const testRunCheck = checks.find(c => c.name === 'Tests run successfully');
    expect(testRunCheck).toBeDefined();
    expect(testRunCheck!.pass).toBe(false);
    expect(testRunCheck!.detail).toContain('failed');
    expect(testRunCheck!.fix).toContain('Fix failing tests');

    execSyncSpy.mockRestore();
  });

  it('detects LLM references with line number', () => {
    writeFileSync(join(tempDir, 'AGENTS.md'), '# Agents\n## Commands\nUse Claude for code review\n## Build\n## Test\n## Lint\n');
    const checks = runAllChecks(tempDir, makeConfig());
    const llmCheck = checks.find(c => c.name.includes('LLM'));
    expect(llmCheck).toBeDefined();
    expect(llmCheck!.pass).toBe(false);
    expect(llmCheck!.detail).toContain('line 3');
    expect(llmCheck!.detail).toContain('claude');
    expect(llmCheck!.fix).toContain('line 3');
  });

  it('reports product-specs file count', () => {
    const specsDir = join(tempDir, 'docs', 'product-specs');
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, 'auth.md'), '# Auth Spec\n');
    writeFileSync(join(specsDir, 'billing.md'), '# Billing Spec\n');
    const checks = runAllChecks(tempDir, makeConfig());
    const specsCheck = checks.find(c => c.name.includes('product-specs'));
    expect(specsCheck).toBeDefined();
    expect(specsCheck!.pass).toBe(true);
    expect(specsCheck!.detail).toContain('2 spec file(s)');
  });

  it('reports architecture doc domain count', () => {
    writeFileSync(join(tempDir, 'ARCHITECTURE.md'), '# Architecture\n## Auth Domain\n## Billing Domain\n## User Domain\n');
    const checks = runAllChecks(tempDir, makeConfig());
    const archCheck = checks.find(c => c.name.includes('describes boundaries'));
    expect(archCheck).toBeDefined();
    expect(archCheck!.pass).toBe(true);
    expect(archCheck!.detail).toContain('3 domain(s)/section(s)');
  });

  it('detects Python linter from pyproject.toml', () => {
    writeFileSync(join(tempDir, 'pyproject.toml'), '[tool.ruff]\nline-length = 88\n');
    const checks = runAllChecks(tempDir, makeConfig());
    const lintCheck = checks.find(c => c.name === 'Linter configured');
    expect(lintCheck).toBeDefined();
    expect(lintCheck!.pass).toBe(true);
  });

  it('detects Go linter from golangci-lint config', () => {
    writeFileSync(join(tempDir, 'go.mod'), 'module example.com/test\ngo 1.21\n');
    writeFileSync(join(tempDir, '.golangci.yml'), 'linters:\n  enable:\n    - govet\n');
    const checks = runAllChecks(tempDir, makeConfig());
    const lintCheck = checks.find(c => c.name === 'Linter configured');
    expect(lintCheck).toBeDefined();
    expect(lintCheck!.pass).toBe(true);
  });

  it('reports no linter for Go project without golangci-lint config', () => {
    writeFileSync(join(tempDir, 'go.mod'), 'module example.com/test\ngo 1.21\n');
    const checks = runAllChecks(tempDir, makeConfig());
    const lintCheck = checks.find(c => c.name === 'Linter configured');
    expect(lintCheck).toBeDefined();
    expect(lintCheck!.pass).toBe(false);
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

  it('doctor --fix auto-proceeds in non-TTY mode', async () => {
    const origCwd = process.cwd();
    process.chdir(tempDir);
    setStdinIsTty(false);

    const initSpy = vi.spyOn(initModule, 'initCommand').mockResolvedValue();

    try {
      await doctorCommand({ fix: true });
    } finally {
      process.chdir(origCwd);
    }

    expect(initSpy).toHaveBeenCalledWith({ defaults: true });
  });

  it('fails motivation check when spec has no ## Motivation section', () => {
    const specsDir = join(tempDir, 'docs', 'product-specs');
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, 'auth.md'), '# Auth Spec\n## Requirements\nSome requirements.\n');
    const checks = runAllChecks(tempDir, makeConfig());
    const check = checks.find(c => c.name === 'Spec files have ## Motivation sections');
    expect(check).toBeDefined();
    expect(check!.pass).toBe(false);
  });

  it('passes motivation check when spec has ## Motivation section', () => {
    const specsDir = join(tempDir, 'docs', 'product-specs');
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, 'auth.md'), '# Auth Spec\n## Motivation\nWhy this exists.\n## Requirements\nSome requirements.\n');
    const checks = runAllChecks(tempDir, makeConfig());
    const check = checks.find(c => c.name === 'Spec files have ## Motivation sections');
    expect(check).toBeDefined();
    expect(check!.pass).toBe(true);
  });

  it('passes motivation check with "No spec files found" when specs dir is empty', () => {
    const specsDir = join(tempDir, 'docs', 'product-specs');
    mkdirSync(specsDir, { recursive: true });
    const checks = runAllChecks(tempDir, makeConfig());
    const check = checks.find(c => c.name === 'Spec files have ## Motivation sections');
    expect(check).toBeDefined();
    expect(check!.pass).toBe(true);
    expect(check!.detail).toBe('No spec files found');
  });

  it('lists missing filenames in motivation check detail for multiple specs', () => {
    const specsDir = join(tempDir, 'docs', 'product-specs');
    mkdirSync(specsDir, { recursive: true });
    writeFileSync(join(specsDir, 'auth.md'), '# Auth\n## Motivation\nWhy.\n');
    writeFileSync(join(specsDir, 'billing.md'), '# Billing\n## Requirements\nNo motivation here.\n');
    writeFileSync(join(specsDir, 'users.md'), '# Users\n## Requirements\nAlso no motivation.\n');
    const checks = runAllChecks(tempDir, makeConfig());
    const check = checks.find(c => c.name === 'Spec files have ## Motivation sections');
    expect(check).toBeDefined();
    expect(check!.pass).toBe(false);
    expect(check!.detail).toContain('billing.md');
    expect(check!.detail).toContain('users.md');
    expect(check!.detail).not.toContain('auth.md');
  });

  it('doctor --fix lists fixable issues before confirmation', async () => {
    const origCwd = process.cwd();
    process.chdir(tempDir);
    setStdinIsTty(true);

    let output = '';
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      output += `${args.map(a => String(a)).join(' ')}\n`;
    };

    const initSpy = vi.spyOn(initModule, 'initCommand').mockResolvedValue();
    const confirmSpy = vi.spyOn(prompt, 'confirm').mockImplementation(async () => {
      expect(output).toContain('Fixable issues:');
      return false;
    });

    try {
      await doctorCommand({ fix: true });
    } finally {
      console.log = origLog;
      process.chdir(origCwd);
    }

    expect(confirmSpy).toHaveBeenCalled();
    expect(output).toContain('Fixable issues:');
    expect(initSpy).not.toHaveBeenCalled();
  });
});
