import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectTestCommand, detectTypecheckCommand, detectSourcePath, composeValidateCommand, detectCompletedTask, normalizePlanContent } from './detect.js';
import type { RalphConfig } from '../../config/schema.js';

function makeTempDir(): string {
  const dir = join(tmpdir(), `ralph-run-detect-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function baseConfig(overrides: Partial<RalphConfig> = {}): RalphConfig {
  return {
    project: { name: 'test', language: 'typescript' },
    architecture: {
      layers: [],
      direction: 'forward-only',
      rules: { 'max-lines': 500, naming: { schemas: 'kebab-case', types: 'kebab-case' } },
    },
    quality: { 'minimum-grade': 'B', coverage: { tool: 'none', 'report-path': '' } },
    gc: { 'consistency-threshold': 0.7, exclude: [] },
    doctor: { 'minimum-score': 80, 'custom-checks': [] },
    paths: {
      'agents-md': 'AGENTS.md',
      'architecture-md': 'ARCHITECTURE.md',
      docs: 'docs',
      specs: 'docs/product-specs',
      plans: 'docs/plans',
      'design-docs': 'docs/design-docs',
      references: 'docs/references',
      generated: '.ralph/generated',
      quality: '.ralph/quality',
    },
    references: { 'max-total-kb': 500, 'warn-single-file-kb': 100 },
    ...overrides,
  };
}

describe('detectTestCommand', () => {
  let tempDir: string;

  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it('returns config override when set', () => {
    const config = baseConfig({ run: { agent: { cli: 'claude', args: [], timeout: 300 }, 'plan-agent': null, 'build-agent': null, prompts: { plan: null, build: null }, loop: { 'max-iterations': 10, 'stall-threshold': 3, 'iteration-timeout': 900 }, validation: { 'test-command': 'bun test', 'typecheck-command': null }, git: { 'auto-commit': false, 'auto-push': false, 'commit-prefix': '', branch: null } } });
    expect(detectTestCommand(config, tempDir)).toBe('bun test');
  });

  it('returns npm test for TS project with package.json scripts.test', () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run' } }));
    expect(detectTestCommand(baseConfig(), tempDir)).toBe('npm test');
  });

  it('returns make test for project with Makefile test target', () => {
    writeFileSync(join(tempDir, 'Makefile'), 'test:\n\tgo test ./...\n');
    expect(detectTestCommand(baseConfig(), tempDir)).toBe('make test');
  });

  it('returns pytest for Python project with pyproject.toml', () => {
    writeFileSync(join(tempDir, 'pyproject.toml'), '[project]\nname = "app"\n');
    expect(detectTestCommand(baseConfig(), tempDir)).toBe('pytest');
  });

  it('returns go test for Go project with go.mod', () => {
    writeFileSync(join(tempDir, 'go.mod'), 'module github.com/user/app\n\ngo 1.21\n');
    expect(detectTestCommand(baseConfig(), tempDir)).toBe('go test ./...');
  });

  it('returns cargo test for Rust project with Cargo.toml', () => {
    writeFileSync(join(tempDir, 'Cargo.toml'), '[package]\nname = "app"\nversion = "0.1.0"\n');
    expect(detectTestCommand(baseConfig(), tempDir)).toBe('cargo test');
  });

  it('returns null when no indicators found', () => {
    expect(detectTestCommand(baseConfig(), tempDir)).toBeNull();
  });

  it('prefers npm test over Makefile when package.json has scripts.test', () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }));
    writeFileSync(join(tempDir, 'Makefile'), 'test:\n\techo test\n');
    expect(detectTestCommand(baseConfig(), tempDir)).toBe('npm test');
  });

  it('skips npm test when package.json has no scripts.test', () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({ scripts: { build: 'tsc' } }));
    writeFileSync(join(tempDir, 'Makefile'), 'test:\n\techo test\n');
    expect(detectTestCommand(baseConfig(), tempDir)).toBe('make test');
  });

  it('returns null for Makefile without test target', () => {
    writeFileSync(join(tempDir, 'Makefile'), 'build:\n\tgo build ./...\n');
    expect(detectTestCommand(baseConfig(), tempDir)).toBeNull();
  });
});

describe('detectTypecheckCommand', () => {
  let tempDir: string;

  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it('returns config override when set', () => {
    const config = baseConfig({ run: { agent: { cli: 'claude', args: [], timeout: 300 }, 'plan-agent': null, 'build-agent': null, prompts: { plan: null, build: null }, loop: { 'max-iterations': 10, 'stall-threshold': 3, 'iteration-timeout': 900 }, validation: { 'test-command': null, 'typecheck-command': 'deno check' }, git: { 'auto-commit': false, 'auto-push': false, 'commit-prefix': '', branch: null } } });
    expect(detectTypecheckCommand(config, tempDir)).toBe('deno check');
  });

  it('returns npx tsc --noEmit for TS project with tsconfig.json', () => {
    writeFileSync(join(tempDir, 'tsconfig.json'), '{}');
    expect(detectTypecheckCommand(baseConfig(), tempDir)).toBe('npx tsc --noEmit');
  });

  it('returns mypy . for project with mypy.ini', () => {
    writeFileSync(join(tempDir, 'mypy.ini'), '[mypy]\n');
    expect(detectTypecheckCommand(baseConfig(), tempDir)).toBe('mypy .');
  });

  it('returns mypy . for Python project with pyproject.toml [tool.mypy]', () => {
    writeFileSync(join(tempDir, 'pyproject.toml'), '[project]\nname = "app"\n\n[tool.mypy]\nstrict = true\n');
    expect(detectTypecheckCommand(baseConfig(), tempDir)).toBe('mypy .');
  });

  it('returns go vet for Go project with go.mod', () => {
    writeFileSync(join(tempDir, 'go.mod'), 'module github.com/user/app\n\ngo 1.21\n');
    expect(detectTypecheckCommand(baseConfig(), tempDir)).toBe('go vet ./...');
  });

  it('returns null when no indicators found', () => {
    expect(detectTypecheckCommand(baseConfig(), tempDir)).toBeNull();
  });

  it('returns null for pyproject.toml without [tool.mypy]', () => {
    writeFileSync(join(tempDir, 'pyproject.toml'), '[project]\nname = "app"\n');
    expect(detectTypecheckCommand(baseConfig(), tempDir)).toBeNull();
  });
});

describe('detectSourcePath', () => {
  let tempDir: string;

  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it('returns joined domain paths from config', () => {
    const config = baseConfig({ architecture: { layers: [], direction: 'forward-only', domains: [{ name: 'core', path: 'src/core' }, { name: 'api', path: 'src/api' }], rules: { 'max-lines': 500, naming: { schemas: 'kebab-case', types: 'kebab-case' } } } });
    expect(detectSourcePath(config, tempDir)).toBe('src/core src/api');
  });

  it('returns src/ when src directory exists', () => {
    mkdirSync(join(tempDir, 'src'));
    expect(detectSourcePath(baseConfig(), tempDir)).toBe('src');
  });

  it('returns app/ when app directory exists and no src', () => {
    mkdirSync(join(tempDir, 'app'));
    expect(detectSourcePath(baseConfig(), tempDir)).toBe('app');
  });

  it('returns lib/ when lib directory exists and no src or app', () => {
    mkdirSync(join(tempDir, 'lib'));
    expect(detectSourcePath(baseConfig(), tempDir)).toBe('lib');
  });

  it('returns . when no conventional directory found', () => {
    expect(detectSourcePath(baseConfig(), tempDir)).toBe('.');
  });

  it('prefers src over app when both exist', () => {
    mkdirSync(join(tempDir, 'src'));
    mkdirSync(join(tempDir, 'app'));
    expect(detectSourcePath(baseConfig(), tempDir)).toBe('src');
  });

  it('returns . when domains array is empty', () => {
    const config = baseConfig({ architecture: { layers: [], direction: 'forward-only', domains: [], rules: { 'max-lines': 500, naming: { schemas: 'kebab-case', types: 'kebab-case' } } } });
    expect(detectSourcePath(config, tempDir)).toBe('.');
  });
});

describe('composeValidateCommand', () => {
  it('includes all components when both test and typecheck detected', () => {
    expect(composeValidateCommand('npm test', 'npx tsc --noEmit')).toBe(
      'npm test && npx tsc --noEmit && ralph doctor --ci && ralph grade --ci'
    );
  });

  it('omits test when null', () => {
    expect(composeValidateCommand(null, 'npx tsc --noEmit')).toBe(
      'npx tsc --noEmit && ralph doctor --ci && ralph grade --ci'
    );
  });

  it('omits typecheck when null', () => {
    expect(composeValidateCommand('npm test', null)).toBe(
      'npm test && ralph doctor --ci && ralph grade --ci'
    );
  });

  it('returns only ralph commands when both null', () => {
    expect(composeValidateCommand(null, null)).toBe(
      'ralph doctor --ci && ralph grade --ci'
    );
  });

  it('always ends with ralph grade --ci', () => {
    const result = composeValidateCommand('go test ./...', 'go vet ./...');
    expect(result.endsWith('ralph grade --ci')).toBe(true);
  });
});

describe('normalizePlanContent', () => {
  it('normalizes CRLF to LF', () => {
    expect(normalizePlanContent('line1\r\nline2\r\n')).toBe('line1\nline2\n');
  });

  it('trims trailing whitespace per line', () => {
    expect(normalizePlanContent('line1   \nline2\t\nline3')).toBe('line1\nline2\nline3');
  });

  it('handles mixed CRLF and LF', () => {
    expect(normalizePlanContent('a\r\nb\nc\r\n')).toBe('a\nb\nc\n');
  });

  it('preserves leading whitespace', () => {
    expect(normalizePlanContent('  - item   \n')).toBe('  - item\n');
  });
});

describe('detectCompletedTask', () => {
  let tempDir: string;
  let origCwd: string;

  beforeEach(() => {
    origCwd = process.cwd();
    tempDir = makeTempDir();
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('detects [ ] → [x] transition', () => {
    const before = '- [ ] Implement user auth\n- [ ] Add tests\n';
    writeFileSync(join(tempDir, 'IMPLEMENTATION_PLAN.md'), '- [x] Implement user auth\n- [ ] Add tests\n');
    expect(detectCompletedTask(before)).toBe('Implement user auth');
  });

  it('detects case-insensitive [X] checkbox', () => {
    const before = '- [ ] Build the widget\n';
    writeFileSync(join(tempDir, 'IMPLEMENTATION_PLAN.md'), '- [X] Build the widget\n');
    expect(detectCompletedTask(before)).toBe('Build the widget');
  });

  it('detects ✅ gained as prefix', () => {
    const before = '- Deploy to staging\n';
    writeFileSync(join(tempDir, 'IMPLEMENTATION_PLAN.md'), '- ✅ Deploy to staging\n');
    expect(detectCompletedTask(before)).toBe('Deploy to staging');
  });

  it('detects ✅ gained as suffix', () => {
    const before = '- Deploy to staging\n';
    writeFileSync(join(tempDir, 'IMPLEMENTATION_PLAN.md'), '- Deploy to staging ✅\n');
    expect(detectCompletedTask(before)).toBe('Deploy to staging');
  });

  it('returns null when no match', () => {
    const before = '- [ ] Some task\n';
    writeFileSync(join(tempDir, 'IMPLEMENTATION_PLAN.md'), '- [ ] Some task\n');
    expect(detectCompletedTask(before)).toBeNull();
  });

  it('returns null for whitespace-only changes', () => {
    const before = '- [ ] Some task\n';
    writeFileSync(join(tempDir, 'IMPLEMENTATION_PLAN.md'), '- [ ] Some task  \n');
    expect(detectCompletedTask(before)).toBeNull();
  });

  it('returns first completed task when multiple are completed', () => {
    const before = '- [ ] Task A\n- [ ] Task B\n- [ ] Task C\n';
    writeFileSync(join(tempDir, 'IMPLEMENTATION_PLAN.md'), '- [x] Task A\n- [x] Task B\n- [ ] Task C\n');
    expect(detectCompletedTask(before)).toBe('Task A');
  });

  it('returns null when IMPLEMENTATION_PLAN.md does not exist', () => {
    const before = '- [ ] Some task\n';
    expect(detectCompletedTask(before)).toBeNull();
  });

  it('returns null when already-checked box stays checked', () => {
    const before = '- [x] Already done\n- [ ] Pending\n';
    writeFileSync(join(tempDir, 'IMPLEMENTATION_PLAN.md'), '- [x] Already done\n- [ ] Pending\n');
    expect(detectCompletedTask(before)).toBeNull();
  });
});
