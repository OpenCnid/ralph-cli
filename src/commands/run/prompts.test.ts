import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generatePrompt, generateAdversarialPrompt, PLAN_TEMPLATE, BUILD_TEMPLATE } from './prompts.js';
import type { RalphConfig } from '../../config/schema.js';
import { DEFAULT_ADVERSARIAL } from '../../config/defaults.js';

function makeTempDir(): string {
  const dir = join(tmpdir(), `ralph-run-prompts-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function baseConfig(overrides: Partial<RalphConfig> = {}): RalphConfig {
  return {
    project: { name: 'my-project', language: 'typescript' },
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
    run: {
      agent: { cli: 'claude', args: [], timeout: 300 },
      'plan-agent': null,
      'build-agent': null,
      prompts: { plan: null, build: null },
      loop: { 'max-iterations': 10, 'stall-threshold': 3, 'iteration-timeout': 900 },
      validation: { 'test-command': 'npm test', 'typecheck-command': 'npx tsc --noEmit' },
      git: { 'auto-commit': false, 'auto-push': false, 'commit-prefix': '', branch: null },
      adversarial: DEFAULT_ADVERSARIAL,
    },
    ...overrides,
  };
}

let origCwd: string;
let tempDir: string;

beforeEach(() => {
  origCwd = process.cwd();
  tempDir = makeTempDir();
  mkdirSync(join(tempDir, '.git'), { recursive: true });
  process.chdir(tempDir);
});

afterEach(() => {
  process.chdir(origCwd);
  rmSync(tempDir, { recursive: true, force: true });
});

describe('PLAN_TEMPLATE and BUILD_TEMPLATE', () => {
  it('PLAN_TEMPLATE includes all required variables', () => {
    const vars = [
      '{validate_command}', '{test_command}', '{project_name}', '{project_path}',
      '{src_path}', '{specs_path}', '{date}', '{skip_tasks}', '{language}',
      '{framework}', '{typecheck_command}',
    ];
    for (const v of vars) {
      expect(PLAN_TEMPLATE).toContain(v);
    }
  });

  it('BUILD_TEMPLATE includes all required variables', () => {
    const vars = [
      '{validate_command}', '{test_command}', '{project_name}', '{project_path}',
      '{src_path}', '{specs_path}', '{date}', '{skip_tasks}', '{language}',
      '{framework}', '{typecheck_command}',
    ];
    for (const v of vars) {
      expect(BUILD_TEMPLATE).toContain(v);
    }
  });
});

describe('generatePrompt — built-in templates', () => {
  it('substitutes all variables in plan mode', () => {
    const config = baseConfig();
    const result = generatePrompt('plan', config);

    expect(result).toContain('my-project');
    expect(result).toContain(tempDir);
    expect(result).toContain('docs/product-specs');
    expect(result).toContain('typescript');
    expect(result).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(result).toContain('npm test');
    expect(result).toContain('npx tsc --noEmit');
    expect(result).not.toContain('{project_name}');
    expect(result).not.toContain('{project_path}');
    expect(result).not.toContain('{src_path}');
    expect(result).not.toContain('{specs_path}');
    expect(result).not.toContain('{date}');
    expect(result).not.toContain('{language}');
    expect(result).not.toContain('{test_command}');
    expect(result).not.toContain('{typecheck_command}');
    expect(result).not.toContain('{validate_command}');
  });

  it('substitutes all variables in build mode', () => {
    const config = baseConfig();
    const result = generatePrompt('build', config);

    expect(result).toContain('my-project');
    expect(result).toContain(tempDir);
    expect(result).not.toContain('{project_name}');
    expect(result).not.toContain('{validate_command}');
  });

  it('composes {validate_command} from test and typecheck commands', () => {
    const config = baseConfig();
    const result = generatePrompt('build', config);

    expect(result).toContain('npm test && npx tsc --noEmit && ralph doctor --ci && ralph grade --ci');
  });

  it('validate_command with only test command (no typecheck)', () => {
    const config = baseConfig({
      run: {
        agent: { cli: 'claude', args: [], timeout: 300 },
        'plan-agent': null,
        'build-agent': null,
        prompts: { plan: null, build: null },
        loop: { 'max-iterations': 10, 'stall-threshold': 3, 'iteration-timeout': 900 },
        validation: { 'test-command': 'make test', 'typecheck-command': null },
        git: { 'auto-commit': false, 'auto-push': false, 'commit-prefix': '', branch: null },
        adversarial: DEFAULT_ADVERSARIAL,
      },
    });
    const result = generatePrompt('build', config);
    expect(result).toContain('make test && ralph doctor --ci && ralph grade --ci');
    expect(result).not.toContain('npx tsc');
  });

  it('includes framework when set', () => {
    const config = baseConfig({
      project: { name: 'my-project', language: 'typescript', framework: 'nextjs' },
    });
    const result = generatePrompt('plan', config);
    expect(result).toContain('nextjs');
    expect(result).not.toContain('{framework}');
  });

  it('uses empty string for framework when not set', () => {
    const config = baseConfig();
    const result = generatePrompt('plan', config);
    // {framework} should be replaced with empty string (not the literal placeholder)
    expect(result).not.toContain('{framework}');
  });

  it('includes skip_tasks when provided in options', () => {
    const config = baseConfig();
    const result = generatePrompt('build', config, { skipTasks: 'Task 1, Task 2' });
    expect(result).toContain('Task 1, Task 2');
  });

  it('skip_tasks is empty string when not provided', () => {
    const config = baseConfig();
    const result = generatePrompt('plan', config);
    expect(result).not.toContain('{skip_tasks}');
  });

  it('uses plan template for plan mode', () => {
    const config = baseConfig();
    const planResult = generatePrompt('plan', config);
    const buildResult = generatePrompt('build', config);
    // They should differ since they use different templates
    expect(planResult).not.toBe(buildResult);
  });
});

describe('template content quality', () => {
  const PROVIDER_TERMS = ['claude', 'openai', 'anthropic', 'codex', 'gpt'];

  it('PLAN_TEMPLATE contains no provider-specific language', () => {
    const lower = PLAN_TEMPLATE.toLowerCase();
    for (const term of PROVIDER_TERMS) {
      expect(lower).not.toContain(term);
    }
  });

  it('BUILD_TEMPLATE contains no provider-specific language', () => {
    const lower = BUILD_TEMPLATE.toLowerCase();
    for (const term of PROVIDER_TERMS) {
      expect(lower).not.toContain(term);
    }
  });

  it('PLAN_TEMPLATE mentions gap analysis', () => {
    expect(PLAN_TEMPLATE.toLowerCase()).toContain('gap analysis');
  });

  it('PLAN_TEMPLATE mentions IMPLEMENTATION_PLAN.md', () => {
    expect(PLAN_TEMPLATE).toContain('IMPLEMENTATION_PLAN.md');
  });

  it('PLAN_TEMPLATE instructs not to implement anything', () => {
    expect(PLAN_TEMPLATE.toLowerCase()).toMatch(/do not implement|do not implement anything|planning only/i);
  });

  it('BUILD_TEMPLATE mentions finding next unchecked task', () => {
    expect(BUILD_TEMPLATE).toContain('[ ]');
    expect(BUILD_TEMPLATE).toContain('IMPLEMENTATION_PLAN.md');
  });

  it('BUILD_TEMPLATE instructs to mark task complete', () => {
    expect(BUILD_TEMPLATE).toContain('[x]');
  });

  it('BUILD_TEMPLATE instructs to run validate command and fix failures', () => {
    expect(BUILD_TEMPLATE).toContain('{validate_command}');
    expect(BUILD_TEMPLATE.toLowerCase()).toMatch(/fix.*fail|fail.*fix/i);
  });

  it('BUILD_TEMPLATE instructs one task per iteration', () => {
    expect(BUILD_TEMPLATE.toLowerCase()).toMatch(/one task|do not work on more than one/i);
  });

  it('plan template generated prompt mentions gap analysis', () => {
    const config = baseConfig();
    const result = generatePrompt('plan', config);
    expect(result.toLowerCase()).toContain('gap analysis');
  });

  it('build template generated prompt mentions IMPLEMENTATION_PLAN.md unchecked task', () => {
    const config = baseConfig();
    const result = generatePrompt('build', config);
    expect(result).toContain('IMPLEMENTATION_PLAN.md');
    expect(result).toContain('[ ]');
  });
});

describe('generateAdversarialPrompt', () => {
  const baseOpts = {
    builderDiff: 'diff --git a/src/foo.ts b/src/foo.ts\n+const x = 1;',
    specContent: 'The function must handle null inputs.',
    existingTests: 'describe("foo", () => { it("works", () => {}) })',
    stageResults: null,
    budget: 7,
    testCommand: 'npm test',
  };

  it('contains the configured budget value', () => {
    const result = generateAdversarialPrompt({ ...baseOpts, budget: 12 });
    expect(result).toContain('12');
  });

  it('contains the builderDiff content', () => {
    const result = generateAdversarialPrompt(baseOpts);
    expect(result).toContain('diff --git a/src/foo.ts b/src/foo.ts');
    expect(result).toContain('+const x = 1;');
  });

  it('contains all 9 rule constraint items', () => {
    const result = generateAdversarialPrompt(baseOpts);
    // Verify all 9 numbered rules are present
    expect(result).toContain('1.');
    expect(result).toContain('2.');
    expect(result).toContain('3.');
    expect(result).toContain('4.');
    expect(result).toContain('5.');
    expect(result).toContain('6.');
    expect(result).toContain('7.');
    expect(result).toContain('8.');
    expect(result).toContain('9.');
    // Spot-check rule content
    expect(result).toContain('Write tests only');
    expect(result).toContain('Do not delete or rewrite existing tests');
    expect(result).toContain('IMPLEMENTATION_PLAN.md');
    expect(result).toContain('Target edge cases');
    expect(result).toContain('Be specific');
    expect(result).toContain('Do not fix implementation bugs');
  });

  it('contains stageResults when provided', () => {
    const result = generateAdversarialPrompt({ ...baseOpts, stageResults: 'All 42 tests passed.' });
    expect(result).toContain('All 42 tests passed.');
  });

  it('substitutes default stage_results when stageResults is null', () => {
    const result = generateAdversarialPrompt({ ...baseOpts, stageResults: null });
    expect(result).toContain('Validation passed.');
  });

  it('contains specContent', () => {
    const result = generateAdversarialPrompt(baseOpts);
    expect(result).toContain('The function must handle null inputs.');
  });

  it('contains existingTests', () => {
    const result = generateAdversarialPrompt(baseOpts);
    expect(result).toContain('describe("foo"');
  });

  it('contains testCommand in rule 8', () => {
    const result = generateAdversarialPrompt({ ...baseOpts, testCommand: 'yarn test' });
    expect(result).toContain('yarn test');
  });

  it('leaves no unresolved {placeholders} from the template', () => {
    const result = generateAdversarialPrompt(baseOpts);
    // All known template variables should be substituted
    expect(result).not.toContain('{builder_diff}');
    expect(result).not.toContain('{spec_content}');
    expect(result).not.toContain('{existing_tests}');
    expect(result).not.toContain('{stage_results}');
    expect(result).not.toContain('{budget}');
    expect(result).not.toContain('{test_command}');
  });
});

describe('generatePrompt — custom templates', () => {
  it('loads custom plan template from file path', () => {
    const templatePath = join(tempDir, 'plan-template.txt');
    writeFileSync(templatePath, 'Custom plan for {project_name} on {date}');
    const config = baseConfig({
      run: {
        agent: { cli: 'claude', args: [], timeout: 300 },
        'plan-agent': null,
        'build-agent': null,
        prompts: { plan: templatePath, build: null },
        loop: { 'max-iterations': 10, 'stall-threshold': 3, 'iteration-timeout': 900 },
        validation: { 'test-command': 'npm test', 'typecheck-command': null },
        git: { 'auto-commit': false, 'auto-push': false, 'commit-prefix': '', branch: null },
        adversarial: DEFAULT_ADVERSARIAL,
      },
    });
    const result = generatePrompt('plan', config);
    expect(result).toContain('Custom plan for my-project on ');
    expect(result).toMatch(/Custom plan for my-project on \d{4}-\d{2}-\d{2}/);
  });

  it('loads custom build template from file path', () => {
    const templatePath = join(tempDir, 'build-template.txt');
    writeFileSync(templatePath, 'Build {project_name} using {validate_command}');
    const config = baseConfig({
      run: {
        agent: { cli: 'claude', args: [], timeout: 300 },
        'plan-agent': null,
        'build-agent': null,
        prompts: { plan: null, build: templatePath },
        loop: { 'max-iterations': 10, 'stall-threshold': 3, 'iteration-timeout': 900 },
        validation: { 'test-command': 'npm test', 'typecheck-command': null },
        git: { 'auto-commit': false, 'auto-push': false, 'commit-prefix': '', branch: null },
        adversarial: DEFAULT_ADVERSARIAL,
      },
    });
    const result = generatePrompt('build', config);
    expect(result).toBe('Build my-project using npm test && ralph doctor --ci && ralph grade --ci');
  });

  it('leaves unknown variables in custom templates as-is', () => {
    const templatePath = join(tempDir, 'custom.txt');
    writeFileSync(templatePath, 'Hello {unknown_var} and {project_name}');
    const config = baseConfig({
      run: {
        agent: { cli: 'claude', args: [], timeout: 300 },
        'plan-agent': null,
        'build-agent': null,
        prompts: { plan: templatePath, build: null },
        loop: { 'max-iterations': 10, 'stall-threshold': 3, 'iteration-timeout': 900 },
        validation: { 'test-command': null, 'typecheck-command': null },
        git: { 'auto-commit': false, 'auto-push': false, 'commit-prefix': '', branch: null },
        adversarial: DEFAULT_ADVERSARIAL,
      },
    });
    const result = generatePrompt('plan', config);
    expect(result).toContain('{unknown_var}');
    expect(result).toContain('my-project');
  });

  it('handles missing optional variables in custom templates gracefully', () => {
    const templatePath = join(tempDir, 'partial.txt');
    // Only uses a subset of variables
    writeFileSync(templatePath, 'Project: {project_name}\nLang: {language}');
    const config = baseConfig({
      run: {
        agent: { cli: 'claude', args: [], timeout: 300 },
        'plan-agent': null,
        'build-agent': null,
        prompts: { plan: templatePath, build: null },
        loop: { 'max-iterations': 10, 'stall-threshold': 3, 'iteration-timeout': 900 },
        validation: { 'test-command': null, 'typecheck-command': null },
        git: { 'auto-commit': false, 'auto-push': false, 'commit-prefix': '', branch: null },
        adversarial: DEFAULT_ADVERSARIAL,
      },
    });
    const result = generatePrompt('plan', config);
    expect(result).toBe('Project: my-project\nLang: typescript');
  });
});
