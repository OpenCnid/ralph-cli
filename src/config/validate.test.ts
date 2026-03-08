import { describe, it, expect } from 'vitest';
import { validate } from './validate.js';

describe('validate', () => {
  it('accepts minimal valid config', () => {
    const result = validate({
      project: { name: 'test', language: 'typescript' },
    });
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
      doctor: { 'minimum-score': 8, 'custom-checks': [] },
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

  it('warns on unknown top-level keys', () => {
    const result = validate({
      project: { name: 'test', language: 'typescript' },
      unknown_key: true,
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('unknown_key');
  });

  it('errors on invalid architecture.layers type', () => {
    const result = validate({
      project: { name: 'test', language: 'typescript' },
      architecture: { layers: 'not-an-array' },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('architecture.layers');
  });

  it('errors on invalid quality.minimum-grade', () => {
    const result = validate({
      project: { name: 'test', language: 'typescript' },
      quality: { 'minimum-grade': 'Z' },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('minimum-grade');
  });

  it('errors on invalid quality.coverage.tool', () => {
    const result = validate({
      project: { name: 'test', language: 'typescript' },
      quality: { coverage: { tool: 'invalid' } },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('coverage.tool');
  });

  it('errors on invalid doctor.minimum-score', () => {
    const result = validate({
      project: { name: 'test', language: 'typescript' },
      doctor: { 'minimum-score': 15 },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('minimum-score');
  });

  it('errors on invalid gc.consistency-threshold', () => {
    const result = validate({
      project: { name: 'test', language: 'typescript' },
      gc: { 'consistency-threshold': -5 },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('consistency-threshold');
  });

  it('errors on invalid files.max-lines', () => {
    const result = validate({
      project: { name: 'test', language: 'typescript' },
      architecture: { files: { 'max-lines': -1 } },
    });
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('max-lines');
  });

  it('warns on unknown runner.cli value', () => {
    const result = validate({
      project: { name: 'test', language: 'typescript' },
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
        project: { name: 'test', language: 'typescript' },
        quality: { 'minimum-grade': grade },
      });
      expect(result.errors).toEqual([]);
    }
  });
});
