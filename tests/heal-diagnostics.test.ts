import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  diagnosticRuntime,
  parseDoctorOutput,
  parseGradeOutput,
  parseGcOutput,
  parseLintOutput,
  runDiagnostics,
} from '../src/commands/heal/diagnostics.js';

// ─── parseDoctorOutput ────────────────────────────────────────────────────────

describe('parseDoctorOutput', () => {
  it('counts lines starting with ✗', () => {
    const output = [
      '  Checking AGENTS.md...',
      '✗ AGENTS.md missing or empty',
      '✓ ARCHITECTURE.md present',
      '✗ No design docs found',
    ].join('\n');
    expect(parseDoctorOutput(output)).toBe(2);
  });

  it('returns 0 when no failures', () => {
    const output = '✓ All checks passed\n✓ Another pass';
    expect(parseDoctorOutput(output)).toBe(0);
  });

  it('returns 0 for empty output', () => {
    expect(parseDoctorOutput('')).toBe(0);
  });
});

// ─── parseGradeOutput ─────────────────────────────────────────────────────────

describe('parseGradeOutput', () => {
  it('counts lines with Overall grade F', () => {
    const output = [
      'Domain: src/commands/gc',
      'Overall grade F',
      'Domain: src/commands/run',
      'Overall grade B',
      'Domain: src/commands/lint',
      'Overall grade D',
    ].join('\n');
    expect(parseGradeOutput(output)).toBe(2);
  });

  it('returns 0 when no D or F grades', () => {
    const output = 'Overall grade A\nOverall grade B\nOverall grade C';
    expect(parseGradeOutput(output)).toBe(0);
  });

  it('counts F grade', () => {
    expect(parseGradeOutput('Overall grade F')).toBe(1);
  });

  it('counts D grade', () => {
    expect(parseGradeOutput('Overall grade D')).toBe(1);
  });
});

// ─── parseGcOutput ────────────────────────────────────────────────────────────

describe('parseGcOutput', () => {
  it('counts lines starting with ⚠', () => {
    const output = [
      'Scanning for drift...',
      '⚠ Orphaned file: src/old.ts',
      '  Details about the file',
      '⚠ Dead export: unusedFn in src/utils.ts',
    ].join('\n');
    expect(parseGcOutput(output)).toBe(2);
  });

  it('returns 0 when no warnings', () => {
    expect(parseGcOutput('All clean\nNothing to report')).toBe(0);
  });

  it('returns 0 for empty output', () => {
    expect(parseGcOutput('')).toBe(0);
  });
});

// ─── parseLintOutput ──────────────────────────────────────────────────────────

describe('parseLintOutput', () => {
  it('counts lines starting with ✗', () => {
    const output = [
      'Linting...',
      '✗ src/commands/lint/index.ts: dependency direction violation',
      '✓ src/config/schema.ts: ok',
      '✗ src/commands/gc/index.ts: file size violation',
    ].join('\n');
    expect(parseLintOutput(output)).toBe(2);
  });

  it('counts lines containing "violation"', () => {
    const output = [
      'Found 3 violations in architecture check',
      'Domain isolation violation in src/commands/run',
    ].join('\n');
    expect(parseLintOutput(output)).toBe(2);
  });

  it('returns 0 for clean output', () => {
    expect(parseLintOutput('No issues found.\nAll files pass.')).toBe(0);
  });
});

describe('runDiagnostics', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('runs all commands and parses results', async () => {
    const mockRunCommand = vi.spyOn(diagnosticRuntime, 'runCommand');
    mockRunCommand
      .mockResolvedValueOnce({ output: '✗ Missing AGENTS.md', exitCode: 1 })
      .mockResolvedValueOnce({ output: 'Overall grade D\n', exitCode: 1 });

    const results = await runDiagnostics(['ralph doctor', 'ralph grade --ci'], {});
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ command: 'ralph doctor', issues: 1, exitCode: 1 });
    expect(results[1]).toMatchObject({ command: 'ralph grade --ci', issues: 1, exitCode: 1 });
  });

  it('applies --only filter', async () => {
    const mockRunCommand = vi.spyOn(diagnosticRuntime, 'runCommand');
    mockRunCommand.mockResolvedValueOnce({ output: '✗ issue', exitCode: 1 });

    const results = await runDiagnostics(['ralph doctor', 'ralph grade --ci', 'ralph gc'], { only: 'doctor' });
    expect(mockRunCommand).toHaveBeenCalledTimes(1);
    expect(results[0].command).toBe('ralph doctor');
  });

  it('applies --skip filter', async () => {
    const mockRunCommand = vi.spyOn(diagnosticRuntime, 'runCommand');
    mockRunCommand
      .mockResolvedValueOnce({ output: '', exitCode: 0 })
      .mockResolvedValueOnce({ output: '', exitCode: 0 });

    const results = await runDiagnostics(['ralph doctor', 'ralph grade --ci', 'ralph gc'], { skip: 'grade' });
    expect(mockRunCommand).toHaveBeenCalledTimes(2);
    expect(results.map((r) => r.command)).toEqual(['ralph doctor', 'ralph gc']);
  });

  it('skip wins when both only and skip match', async () => {
    const mockRunCommand = vi.spyOn(diagnosticRuntime, 'runCommand');
    mockRunCommand.mockResolvedValueOnce({ output: '', exitCode: 0 });

    const results = await runDiagnostics(['ralph doctor', 'ralph grade --ci'], {
      only: 'doctor,grade',
      skip: 'grade',
    });
    expect(mockRunCommand).toHaveBeenCalledTimes(1);
    expect(results[0].command).toBe('ralph doctor');
  });

  it('returns empty array when all commands are skipped', async () => {
    const mockRunCommand = vi.spyOn(diagnosticRuntime, 'runCommand');

    const results = await runDiagnostics(['ralph doctor'], { skip: 'doctor' });
    expect(mockRunCommand).not.toHaveBeenCalled();
    expect(results).toHaveLength(0);
  });
});
