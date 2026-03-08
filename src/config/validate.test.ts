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
        files: { 'max-lines': 300, naming: { schemas: '*Schema', types: '*Type' } },
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

  it('warns on unknown nested keys in architecture.files', () => {
    const result = validate({
      ...MINIMAL,
      architecture: { files: { 'max-lines': 500, extra: true } },
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('architecture.files.extra');
  });

  it('warns on unknown nested keys in architecture.files.naming', () => {
    const result = validate({
      ...MINIMAL,
      architecture: { files: { naming: { schemas: '*Schema', extra: true } } },
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('architecture.files.naming.extra');
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

  // architecture.files.naming validation
  it('errors on non-object architecture.files.naming', () => {
    const result = validate({
      ...MINIMAL,
      architecture: { files: { naming: 'bad' } },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('architecture.files.naming');
  });

  it('errors on non-string naming.schemas', () => {
    const result = validate({
      ...MINIMAL,
      architecture: { files: { naming: { schemas: 42 } } },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('naming.schemas');
  });

  it('errors on non-string naming.types', () => {
    const result = validate({
      ...MINIMAL,
      architecture: { files: { naming: { types: true } } },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('naming.types');
  });

  it('errors on non-object architecture.files', () => {
    const result = validate({
      ...MINIMAL,
      architecture: { files: 'bad' },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('architecture.files');
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
      architecture: { files: { 'max-lines': -1 } },
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
