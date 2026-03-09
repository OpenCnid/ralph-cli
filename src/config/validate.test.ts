import { describe, it, expect } from 'vitest';
import { validate } from './validate.js';

const MINIMAL = { project: { name: 'test', language: 'typescript' } };

describe('validate', () => {
  it('accepts minimal valid config', () => {
    const result = validate(MINIMAL);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('accepts full valid config', () => {
    const result = validate({
      project: { name: 'test', language: 'python', description: 'A project', framework: 'django' },
      runner: { cli: 'codex' },
      architecture: {
        layers: ['types', 'data', 'service'],
        domains: [{ name: 'auth', path: 'src/auth' }],
        'cross-cutting': ['src/shared'],
        rules: { 'max-lines': 300, naming: { schemas: '*Schema', types: '*Type' } },
      },
      quality: { 'minimum-grade': 'B', coverage: { tool: 'pytest', 'report-path': 'coverage.xml' } },
      gc: { 'consistency-threshold': 70, exclude: ['node_modules'] },
      doctor: { 'minimum-score': 8, 'custom-checks': ['scripts/check.sh'] },
      paths: { 'agents-md': 'AGENTS.md' },
      references: { 'max-total-kb': 150, 'warn-single-file-kb': 50 },
      ci: { quality: { 'minimum-grade': 'A' }, doctor: { 'minimum-score': 9 } },
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('errors on null input', () => {
    const result = validate(null);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('Config must be a YAML object');
  });

  it('errors on missing project section', () => {
    const result = validate({});
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('Missing required "project"');
  });

  it('errors on missing project.name', () => {
    const result = validate({ project: { language: 'typescript' } });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('project.name');
  });

  it('errors on missing project.language', () => {
    const result = validate({ project: { name: 'test' } });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('project.language');
  });

  it('errors on invalid project.language', () => {
    const result = validate({ project: { name: 'test', language: 'cobol' } });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('Invalid "project.language"');
    expect(result.errors[0]).toContain('cobol');
  });

  it('errors on non-string project.description', () => {
    const result = validate({ project: { name: 'test', language: 'typescript', description: 42 } });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('project.description');
  });

  it('errors on non-string project.framework', () => {
    const result = validate({ project: { name: 'test', language: 'typescript', framework: true } });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('project.framework');
  });

  it('warns on unknown top-level keys', () => {
    const result = validate({
      project: { name: 'test', language: 'typescript' },
      unknown_key: true,
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('unknown_key');
  });

  it('warns on unknown nested keys in project', () => {
    const result = validate({
      project: { name: 'test', language: 'typescript', extra: 'field' },
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('project.extra');
  });

  it('warns on unknown nested keys in architecture', () => {
    const result = validate({
      ...MINIMAL,
      architecture: { layers: ['types'], unknown_arch: true },
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('architecture.unknown_arch');
  });

  it('accepts valid architecture.direction', () => {
    const result = validate({
      ...MINIMAL,
      architecture: { direction: 'forward-only' },
    });
    expect(result.errors).toEqual([]);
  });

  it('errors on invalid architecture.direction', () => {
    const result = validate({
      ...MINIMAL,
      architecture: { direction: 'backward-only' },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('architecture.direction');
    expect(result.errors[0]).toContain('forward-only');
  });

  it('warns on unknown nested keys in quality', () => {
    const result = validate({
      ...MINIMAL,
      quality: { 'minimum-grade': 'B', extra: true },
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('quality.extra');
  });

  it('warns on unknown nested keys in gc', () => {
    const result = validate({
      ...MINIMAL,
      gc: { 'consistency-threshold': 60, extra: true },
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('gc.extra');
  });

  it('warns on unknown nested keys in doctor', () => {
    const result = validate({
      ...MINIMAL,
      doctor: { 'minimum-score': 7, extra: true },
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('doctor.extra');
  });

  it('warns on unknown nested keys in paths', () => {
    const result = validate({
      ...MINIMAL,
      paths: { 'agents-md': 'AGENTS.md', unknown_path: 'foo' },
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('paths.unknown_path');
  });

  it('warns on unknown nested keys in references', () => {
    const result = validate({
      ...MINIMAL,
      references: { 'max-total-kb': 200, extra: true },
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('references.extra');
  });

  it('warns on unknown nested keys in ci', () => {
    const result = validate({
      ...MINIMAL,
      ci: { quality: {}, extra: true },
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('ci.extra');
  });

  it('warns on unknown nested keys in runner', () => {
    const result = validate({
      ...MINIMAL,
      runner: { cli: 'codex', extra: true },
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('runner.extra');
  });

  it('warns on unknown nested keys in architecture.rules', () => {
    const result = validate({
      ...MINIMAL,
      architecture: { rules: { 'max-lines': 500, extra: true } },
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('architecture.rules.extra');
  });

  it('warns on unknown nested keys in architecture.rules.naming', () => {
    const result = validate({
      ...MINIMAL,
      architecture: { rules: { naming: { schemas: '*Schema', extra: true } } },
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('architecture.rules.naming.extra');
  });

  it('warns on unknown nested keys in quality.coverage', () => {
    const result = validate({
      ...MINIMAL,
      quality: { coverage: { tool: 'vitest', extra: true } },
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('quality.coverage.extra');
  });

  // architecture.layers content validation
  it('errors on non-string items in architecture.layers', () => {
    const result = validate({
      ...MINIMAL,
      architecture: { layers: ['types', 42, ''] },
    });
    expect(result.errors.length).toBe(2);
    expect(result.errors[0]).toContain('architecture.layers[1]');
    expect(result.errors[1]).toContain('architecture.layers[2]');
  });

  it('errors on invalid architecture.layers type', () => {
    const result = validate({
      ...MINIMAL,
      architecture: { layers: 'not-an-array' },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('architecture.layers');
  });

  // architecture.domains validation
  it('errors on non-array architecture.domains', () => {
    const result = validate({
      ...MINIMAL,
      architecture: { domains: 'not-an-array' },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('architecture.domains');
  });

  it('errors on domain missing name', () => {
    const result = validate({
      ...MINIMAL,
      architecture: { domains: [{ path: 'src/auth' }] },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('domains[0].name');
  });

  it('errors on domain missing path', () => {
    const result = validate({
      ...MINIMAL,
      architecture: { domains: [{ name: 'auth' }] },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('domains[0].path');
  });

  it('errors on non-object domain entry', () => {
    const result = validate({
      ...MINIMAL,
      architecture: { domains: ['auth'] },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('domains[0]');
  });

  it('accepts valid domains', () => {
    const result = validate({
      ...MINIMAL,
      architecture: { domains: [{ name: 'auth', path: 'src/auth' }, { name: 'billing', path: 'src/billing' }] },
    });
    expect(result.errors).toEqual([]);
  });

  // architecture.cross-cutting validation
  it('errors on non-array architecture.cross-cutting', () => {
    const result = validate({
      ...MINIMAL,
      architecture: { 'cross-cutting': 'not-an-array' },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('architecture.cross-cutting');
  });

  it('errors on non-string items in architecture.cross-cutting', () => {
    const result = validate({
      ...MINIMAL,
      architecture: { 'cross-cutting': ['shared', 42] },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('architecture.cross-cutting[1]');
  });

  // architecture.rules.naming validation
  it('errors on non-object architecture.rules.naming', () => {
    const result = validate({
      ...MINIMAL,
      architecture: { rules: { naming: 'bad' } },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('architecture.rules.naming');
  });

  it('errors on non-string naming.schemas', () => {
    const result = validate({
      ...MINIMAL,
      architecture: { rules: { naming: { schemas: 42 } } },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('naming.schemas');
  });

  it('errors on non-string naming.types', () => {
    const result = validate({
      ...MINIMAL,
      architecture: { rules: { naming: { types: true } } },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('naming.types');
  });

  it('errors on non-object architecture.rules', () => {
    const result = validate({
      ...MINIMAL,
      architecture: { rules: 'bad' },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('architecture.rules');
  });

  // quality validation
  it('errors on invalid quality.minimum-grade', () => {
    const result = validate({
      ...MINIMAL,
      quality: { 'minimum-grade': 'Z' },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('minimum-grade');
  });

  it('errors on invalid quality.coverage.tool', () => {
    const result = validate({
      ...MINIMAL,
      quality: { coverage: { tool: 'invalid' } },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('coverage.tool');
  });

  it('errors on non-object quality.coverage', () => {
    const result = validate({
      ...MINIMAL,
      quality: { coverage: 'bad' },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('quality.coverage');
  });

  it('errors on non-string quality.coverage.report-path', () => {
    const result = validate({
      ...MINIMAL,
      quality: { coverage: { tool: 'vitest', 'report-path': 42 } },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('coverage.report-path');
  });

  // doctor validation
  it('errors on invalid doctor.minimum-score', () => {
    const result = validate({
      ...MINIMAL,
      doctor: { 'minimum-score': 15 },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('minimum-score');
  });

  it('errors on non-array doctor.custom-checks', () => {
    const result = validate({
      ...MINIMAL,
      doctor: { 'custom-checks': 'not-an-array' },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('doctor.custom-checks');
  });

  it('errors on non-string items in doctor.custom-checks', () => {
    const result = validate({
      ...MINIMAL,
      doctor: { 'custom-checks': ['scripts/check.sh', 42] },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('doctor.custom-checks[1]');
  });

  // gc validation
  it('errors on invalid gc.consistency-threshold', () => {
    const result = validate({
      ...MINIMAL,
      gc: { 'consistency-threshold': -5 },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('consistency-threshold');
  });

  it('errors on non-array gc.exclude', () => {
    const result = validate({
      ...MINIMAL,
      gc: { exclude: 'not-an-array' },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('gc.exclude');
  });

  it('errors on non-string items in gc.exclude', () => {
    const result = validate({
      ...MINIMAL,
      gc: { exclude: ['node_modules', 42] },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('gc.exclude[1]');
  });

  // paths validation
  it('errors on non-object paths', () => {
    const result = validate({
      ...MINIMAL,
      paths: 'bad',
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('"paths" must be an object');
  });

  it('errors on non-string paths values', () => {
    const result = validate({
      ...MINIMAL,
      paths: { 'agents-md': 42 },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('paths.agents-md');
  });

  it('accepts valid paths values', () => {
    const result = validate({
      ...MINIMAL,
      paths: { 'agents-md': 'AGENTS.md', docs: 'documentation', references: 'refs' },
    });
    expect(result.errors).toEqual([]);
  });

  // references validation
  it('errors on non-object references', () => {
    const result = validate({
      ...MINIMAL,
      references: 'bad',
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('"references" must be an object');
  });

  it('errors on non-positive references.max-total-kb', () => {
    const result = validate({
      ...MINIMAL,
      references: { 'max-total-kb': 0 },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('max-total-kb');
  });

  it('errors on non-positive references.warn-single-file-kb', () => {
    const result = validate({
      ...MINIMAL,
      references: { 'warn-single-file-kb': -10 },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('warn-single-file-kb');
  });

  it('errors on non-number references.max-total-kb', () => {
    const result = validate({
      ...MINIMAL,
      references: { 'max-total-kb': 'big' },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('max-total-kb');
  });

  it('accepts valid references values', () => {
    const result = validate({
      ...MINIMAL,
      references: { 'max-total-kb': 200, 'warn-single-file-kb': 80 },
    });
    expect(result.errors).toEqual([]);
  });

  // ci validation
  it('errors on non-object ci', () => {
    const result = validate({
      ...MINIMAL,
      ci: 'bad',
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('"ci" must be an object');
  });

  // files.max-lines validation
  it('errors on invalid files.max-lines', () => {
    const result = validate({
      ...MINIMAL,
      architecture: { rules: { 'max-lines': -1 } },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('max-lines');
  });

  it('warns on unknown runner.cli value', () => {
    const result = validate({
      ...MINIMAL,
      runner: { cli: 'unknown-runner' },
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('unknown-runner');
  });

  it('validates all supported languages', () => {
    for (const lang of ['typescript', 'javascript', 'python', 'go', 'rust', 'multi']) {
      const result = validate({ project: { name: 'test', language: lang } });
      expect(result.errors).toEqual([]);
    }
  });

  it('validates all supported grades', () => {
    for (const grade of ['A', 'B', 'C', 'D', 'F']) {
      const result = validate({
        ...MINIMAL,
        quality: { 'minimum-grade': grade },
      });
      expect(result.errors).toEqual([]);
    }
  });

  // run validation
  it('accepts valid run config', () => {
    const result = validate({
      ...MINIMAL,
      run: {
        agent: { cli: 'claude', args: ['--dangerously-skip-permissions'], timeout: 300 },
        'plan-agent': null,
        'build-agent': { cli: 'claude', args: [], timeout: 600 },
        prompts: { plan: 'prompts/plan.md', build: null },
        loop: { 'max-iterations': 10, 'stall-threshold': 3 },
        validation: { 'test-command': 'npm test', 'typecheck-command': 'npx tsc --noEmit' },
        git: { 'auto-commit': true, 'auto-push': false, 'commit-prefix': 'ralph:', branch: null },
      },
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('errors on missing run.agent.cli', () => {
    const result = validate({
      ...MINIMAL,
      run: { agent: { args: [], timeout: 300 } },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('run.agent.cli');
  });

  it('errors on empty run.agent.cli', () => {
    const result = validate({
      ...MINIMAL,
      run: { agent: { cli: '', timeout: 300 } },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('run.agent.cli');
  });

  it('errors on negative run.agent.timeout', () => {
    const result = validate({
      ...MINIMAL,
      run: { agent: { cli: 'claude', timeout: -1 } },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('run.agent.timeout');
  });

  it('errors on zero run.agent.timeout', () => {
    const result = validate({
      ...MINIMAL,
      run: { agent: { cli: 'claude', timeout: 0 } },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('run.agent.timeout');
  });

  it('errors on negative run.loop.max-iterations', () => {
    const result = validate({
      ...MINIMAL,
      run: { agent: { cli: 'claude' }, loop: { 'max-iterations': -1 } },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('run.loop.max-iterations');
  });

  it('accepts zero run.loop.max-iterations', () => {
    const result = validate({
      ...MINIMAL,
      run: { agent: { cli: 'claude' }, loop: { 'max-iterations': 0 } },
    });
    expect(result.errors).toEqual([]);
  });

  it('warns on unknown keys in run', () => {
    const result = validate({
      ...MINIMAL,
      run: { agent: { cli: 'claude' }, unknown_run_key: true },
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('run.unknown_run_key');
  });

  it('warns on unknown keys in run.agent', () => {
    const result = validate({
      ...MINIMAL,
      run: { agent: { cli: 'claude', extra: true } },
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('run.agent.extra');
  });

  it('errors on plan-agent with invalid shape (missing cli)', () => {
    const result = validate({
      ...MINIMAL,
      run: { agent: { cli: 'claude' }, 'plan-agent': { args: [], timeout: 300 } },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('run.plan-agent.cli');
  });

  it('errors on non-boolean run.git.auto-commit', () => {
    const result = validate({
      ...MINIMAL,
      run: { agent: { cli: 'claude' }, git: { 'auto-commit': 'yes' } },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('run.git.auto-commit');
  });

  it('errors on empty run.git.commit-prefix', () => {
    const result = validate({
      ...MINIMAL,
      run: { agent: { cli: 'claude' }, git: { 'commit-prefix': '' } },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('run.git.commit-prefix');
  });

  it('errors on invalid run.prompts.plan type', () => {
    const result = validate({
      ...MINIMAL,
      run: { agent: { cli: 'claude' }, prompts: { plan: 42 } },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('run.prompts.plan');
  });

  it('accepts null values for nullable run fields', () => {
    const result = validate({
      ...MINIMAL,
      run: {
        agent: { cli: 'claude' },
        'plan-agent': null,
        'build-agent': null,
        prompts: { plan: null, build: null },
        validation: { 'test-command': null, 'typecheck-command': null },
        git: { branch: null },
      },
    });
    expect(result.errors).toEqual([]);
  });

  // review validation
  it('accepts valid review config', () => {
    const result = validate({
      ...MINIMAL,
      review: {
        agent: { cli: 'claude', args: ['--print'], timeout: 600 },
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
      },
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('accepts review with null agent', () => {
    const result = validate({
      ...MINIMAL,
      review: { agent: null },
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('errors on invalid review.scope', () => {
    const result = validate({
      ...MINIMAL,
      review: { scope: 'invalid' },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('review.scope');
  });

  it('errors on invalid review.output.format', () => {
    const result = validate({
      ...MINIMAL,
      review: { output: { format: 'xml' } },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('review.output.format');
  });

  it('errors on invalid review.output.severity-threshold', () => {
    const result = validate({
      ...MINIMAL,
      review: { output: { 'severity-threshold': 'critical' } },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('review.output.severity-threshold');
  });

  it('errors on negative review.context.include-diff-context', () => {
    const result = validate({
      ...MINIMAL,
      review: { context: { 'include-diff-context': -1 } },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('review.context.include-diff-context');
  });

  it('errors on zero review.context.max-diff-lines', () => {
    const result = validate({
      ...MINIMAL,
      review: { context: { 'max-diff-lines': 0 } },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('review.context.max-diff-lines');
  });

  it('warns on unknown keys in review', () => {
    const result = validate({
      ...MINIMAL,
      review: { unknown_key: true },
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('review.unknown_key');
  });

  it('warns on unknown keys in review.context', () => {
    const result = validate({
      ...MINIMAL,
      review: { context: { 'extra-key': 1 } },
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('review.context.extra-key');
  });

  it('warns on unknown keys in review.output', () => {
    const result = validate({
      ...MINIMAL,
      review: { output: { unknown: 'x' } },
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('review.output.unknown');
  });

  it('errors on invalid review.agent shape', () => {
    const result = validate({
      ...MINIMAL,
      review: { agent: { args: [], timeout: 300 } },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('review.agent.cli');
  });

  // heal validation
  it('accepts valid heal config', () => {
    const result = validate({
      ...MINIMAL,
      heal: {
        agent: { cli: 'claude', args: [], timeout: 300 },
        commands: ['doctor', 'grade', 'gc', 'lint'],
        'auto-commit': true,
        'commit-prefix': 'ralph-heal:',
      },
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('accepts heal with null agent', () => {
    const result = validate({
      ...MINIMAL,
      heal: { agent: null },
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('errors on invalid heal.commands entry', () => {
    const result = validate({
      ...MINIMAL,
      heal: { commands: ['doctor', 'invalid-cmd'] },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('heal.commands[1]');
  });

  it('errors on invalid heal.auto-commit type', () => {
    const result = validate({
      ...MINIMAL,
      heal: { 'auto-commit': 'yes' },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('heal.auto-commit');
  });

  it('errors on empty heal.commit-prefix', () => {
    const result = validate({
      ...MINIMAL,
      heal: { 'commit-prefix': '' },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('heal.commit-prefix');
  });

  it('warns on unknown keys within heal', () => {
    const result = validate({
      ...MINIMAL,
      heal: { unknown_key: true },
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('heal.unknown_key');
  });

  it('reports multiple errors simultaneously', () => {
    const result = validate({
      ...MINIMAL,
      architecture: { domains: [{ name: 'auth' }], 'cross-cutting': [42] },
      gc: { exclude: 'bad', 'consistency-threshold': -1 },
      references: { 'max-total-kb': 0, 'warn-single-file-kb': -5 },
    });
    expect(result.errors.length).toBeGreaterThanOrEqual(5);
  });
});
