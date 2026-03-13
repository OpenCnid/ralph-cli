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

describe('scoring config validation', () => {
  it('accepts valid scoring config', () => {
    const result = validate({
      ...MINIMAL,
      scoring: {
        script: './score.sh',
        'regression-threshold': 0.02,
        'cumulative-threshold': 0.10,
        'auto-revert': true,
        'default-weights': { tests: 0.6, coverage: 0.4 },
      },
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('accepts scoring.script as null', () => {
    const result = validate({ ...MINIMAL, scoring: { script: null } });
    expect(result.errors).toEqual([]);
  });

  it('errors on non-object scoring', () => {
    const result = validate({ ...MINIMAL, scoring: 'bad' });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('"scoring"');
  });

  it('errors on scoring.script non-string non-null', () => {
    const result = validate({ ...MINIMAL, scoring: { script: 42 } });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('scoring.script');
  });

  it('errors on scoring.regression-threshold below 0', () => {
    const result = validate({ ...MINIMAL, scoring: { 'regression-threshold': -0.1 } });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('scoring.regression-threshold');
  });

  it('errors on scoring.regression-threshold above 1', () => {
    const result = validate({ ...MINIMAL, scoring: { 'regression-threshold': 1.5 } });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('scoring.regression-threshold');
  });

  it('accepts scoring.regression-threshold at 0 and 1 boundaries', () => {
    expect(validate({ ...MINIMAL, scoring: { 'regression-threshold': 0 } }).errors).toEqual([]);
    expect(validate({ ...MINIMAL, scoring: { 'regression-threshold': 1.0 } }).errors).toEqual([]);
  });

  it('errors on scoring.cumulative-threshold out of range', () => {
    const result = validate({ ...MINIMAL, scoring: { 'cumulative-threshold': 2 } });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('scoring.cumulative-threshold');
  });

  it('errors on scoring.auto-revert non-boolean', () => {
    const result = validate({ ...MINIMAL, scoring: { 'auto-revert': 'yes' } });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('scoring.auto-revert');
  });

  it('errors when default-weights do not sum to 1.0', () => {
    const result = validate({ ...MINIMAL, scoring: { 'default-weights': { tests: 0.5, coverage: 0.3 } } });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('default-weights');
  });

  it('accepts default-weights summing to 1.0 within tolerance', () => {
    const result = validate({ ...MINIMAL, scoring: { 'default-weights': { tests: 0.6001, coverage: 0.4 } } });
    expect(result.errors).toEqual([]);
  });

  it('errors on non-object default-weights', () => {
    const result = validate({ ...MINIMAL, scoring: { 'default-weights': 'bad' } });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('scoring.default-weights');
  });

  it('warns on unknown scoring keys', () => {
    const result = validate({ ...MINIMAL, scoring: { unknown_key: true } });
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('scoring.unknown_key');
  });

  it('warns on unknown default-weights keys', () => {
    const result = validate({ ...MINIMAL, scoring: { 'default-weights': { tests: 0.7, coverage: 0.3, extra: 0 } } });
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('scoring.default-weights.extra');
  });
});

describe('run.validation.stages validation', () => {
  const withStages = (stages: unknown) => ({
    ...MINIMAL,
    run: { validation: { stages } },
  });

  it('accepts empty stages array', () => {
    const result = validate(withStages([]));
    expect(result.errors).toEqual([]);
  });

  it('accepts valid stages with all optional fields', () => {
    const result = validate(withStages([
      { name: 'unit', command: 'npm test', required: true, timeout: 120 },
      { name: 'typecheck', command: 'npx tsc --noEmit', required: true, timeout: 60, 'run-after': 'unit' },
      { name: 'integration', command: 'npm run test:integration', required: false },
    ]));
    expect(result.errors).toEqual([]);
  });

  it('errors on duplicate stage names', () => {
    const result = validate(withStages([
      { name: 'unit', command: 'npm test', required: true },
      { name: 'unit', command: 'npm run unit2', required: false },
    ]));
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors.some(e => e.includes('duplicate') && e.includes('unit'))).toBe(true);
  });

  it('errors on run-after referencing nonexistent stage', () => {
    const result = validate(withStages([
      { name: 'unit', command: 'npm test', required: true, 'run-after': 'nonexistent' },
    ]));
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors.some(e => e.includes('nonexistent'))).toBe(true);
  });

  it('errors on circular run-after chain (A → B → A)', () => {
    const result = validate(withStages([
      { name: 'a', command: 'echo a', required: true, 'run-after': 'b' },
      { name: 'b', command: 'echo b', required: true, 'run-after': 'a' },
    ]));
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors.some(e => e.includes('circular'))).toBe(true);
  });

  it('errors on non-array stages', () => {
    const result = validate(withStages('not-an-array'));
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('run.validation.stages');
  });

  it('errors on stage missing required name', () => {
    const result = validate(withStages([
      { command: 'npm test', required: true },
    ]));
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors.some(e => e.includes('stages[0].name'))).toBe(true);
  });

  it('errors on stage missing required command', () => {
    const result = validate(withStages([
      { name: 'unit', required: true },
    ]));
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors.some(e => e.includes('stages[0].command'))).toBe(true);
  });

  it('errors on stage missing required boolean', () => {
    const result = validate(withStages([
      { name: 'unit', command: 'npm test' },
    ]));
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors.some(e => e.includes('stages[0].required'))).toBe(true);
  });

  it('errors on non-positive integer timeout', () => {
    const result = validate(withStages([
      { name: 'unit', command: 'npm test', required: true, timeout: 0 },
    ]));
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors.some(e => e.includes('stages[0].timeout'))).toBe(true);
  });
});

describe('run.adversarial config validation', () => {
  it('accepts valid adversarial config', () => {
    const result = validate({
      ...MINIMAL,
      run: {
        adversarial: {
          enabled: true,
          agent: 'amp',
          model: 'claude-opus-4-6',
          budget: 10,
          timeout: 600,
          'diagnostic-branch': false,
          'test-patterns': ['**/*.test.ts'],
          'restricted-patterns': ['IMPLEMENTATION_PLAN.md'],
          'skip-on-simplify': false,
        },
      },
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('accepts adversarial with enabled: false (opt-in default)', () => {
    const result = validate({
      ...MINIMAL,
      run: { adversarial: { enabled: false } },
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('errors on budget: 0', () => {
    const result = validate({
      ...MINIMAL,
      run: { adversarial: { budget: 0 } },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('run.adversarial.budget');
  });

  it('errors on negative budget', () => {
    const result = validate({
      ...MINIMAL,
      run: { adversarial: { budget: -3 } },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('run.adversarial.budget');
  });

  it('errors on timeout: -1', () => {
    const result = validate({
      ...MINIMAL,
      run: { adversarial: { timeout: -1 } },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('run.adversarial.timeout');
  });

  it('errors on timeout: 0', () => {
    const result = validate({
      ...MINIMAL,
      run: { adversarial: { timeout: 0 } },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('run.adversarial.timeout');
  });

  it('errors on test-patterns: []', () => {
    const result = validate({
      ...MINIMAL,
      run: { adversarial: { 'test-patterns': [] } },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('run.adversarial.test-patterns');
  });

  it('warns on unknown key in adversarial config', () => {
    const result = validate({
      ...MINIMAL,
      run: { adversarial: { unknown_adv_key: true } },
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('run.adversarial.unknown_adv_key');
  });

  it('errors on non-object run.adversarial', () => {
    const result = validate({
      ...MINIMAL,
      run: { adversarial: 'bad' },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('run.adversarial');
  });
});

describe('calibration config validation', () => {
  it('accepts full valid calibration config', () => {
    const result = validate({
      ...MINIMAL,
      calibration: {
        window: 30,
        'warn-pass-rate': 0.95,
        'warn-discard-rate': 0.01,
        'warn-volatility': 0.005,
      },
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('accepts calibration with only some fields', () => {
    const result = validate({ ...MINIMAL, calibration: { window: 10 } });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('errors on window: 4 (below minimum 5)', () => {
    const result = validate({ ...MINIMAL, calibration: { window: 4 } });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('calibration.window');
  });

  it('errors on window: 1.5 (non-integer)', () => {
    const result = validate({ ...MINIMAL, calibration: { window: 1.5 } });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('calibration.window');
  });

  it('errors on warn-pass-rate: 1.1 (above 1)', () => {
    const result = validate({ ...MINIMAL, calibration: { 'warn-pass-rate': 1.1 } });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('calibration.warn-pass-rate');
  });

  it('errors on warn-pass-rate: 0 (must be > 0)', () => {
    const result = validate({ ...MINIMAL, calibration: { 'warn-pass-rate': 0 } });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('calibration.warn-pass-rate');
  });

  it('errors on warn-discard-rate: -0.1 (below 0)', () => {
    const result = validate({ ...MINIMAL, calibration: { 'warn-discard-rate': -0.1 } });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('calibration.warn-discard-rate');
  });

  it('errors on warn-volatility: -1 (below 0)', () => {
    const result = validate({ ...MINIMAL, calibration: { 'warn-volatility': -1 } });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('calibration.warn-volatility');
  });

  it('accepts warn-pass-rate: 1.0 (boundary)', () => {
    const result = validate({ ...MINIMAL, calibration: { 'warn-pass-rate': 1.0 } });
    expect(result.errors).toEqual([]);
  });

  it('accepts warn-discard-rate: 0 (boundary)', () => {
    const result = validate({ ...MINIMAL, calibration: { 'warn-discard-rate': 0 } });
    expect(result.errors).toEqual([]);
  });

  it('accepts warn-volatility: 0 (boundary)', () => {
    const result = validate({ ...MINIMAL, calibration: { 'warn-volatility': 0 } });
    expect(result.errors).toEqual([]);
  });

  it('warns on unknown calibration keys', () => {
    const result = validate({ ...MINIMAL, calibration: { unknown_key: true } });
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('calibration.unknown_key');
  });

  it('errors on non-object calibration', () => {
    const result = validate({ ...MINIMAL, calibration: 'bad' });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('"calibration"');
  });
});

describe('run.loop.iteration-timeout validation', () => {
  it('accepts valid iteration-timeout', () => {
    const result = validate({ ...MINIMAL, run: { loop: { 'iteration-timeout': 900 } } });
    expect(result.errors).toEqual([]);
  });

  it('accepts iteration-timeout of 0', () => {
    const result = validate({ ...MINIMAL, run: { loop: { 'iteration-timeout': 0 } } });
    expect(result.errors).toEqual([]);
  });

  it('errors on negative iteration-timeout', () => {
    const result = validate({ ...MINIMAL, run: { loop: { 'iteration-timeout': -1 } } });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('run.loop.iteration-timeout');
  });

  it('errors on non-integer iteration-timeout', () => {
    const result = validate({ ...MINIMAL, run: { loop: { 'iteration-timeout': 1.5 } } });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('run.loop.iteration-timeout');
  });

  it('errors on string iteration-timeout', () => {
    const result = validate({ ...MINIMAL, run: { loop: { 'iteration-timeout': '900' } } });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('run.loop.iteration-timeout');
  });
});
