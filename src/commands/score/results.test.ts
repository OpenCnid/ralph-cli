import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { appendResult, readResults } from './results.js';
import type { ResultEntry } from './types.js';

describe('results.ts — 9th column TSV handling', () => {
  let tmpDir: string;
  let origCwd: string;

  beforeEach(() => {
    origCwd = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), 'ralph-results-test-'));
    mkdirSync(join(tmpDir, '.ralph'), { recursive: true });
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeEntry(overrides: Partial<ResultEntry> = {}): ResultEntry {
    return {
      commit: 'abc1234',
      iteration: 1,
      status: 'pass',
      score: 0.8,
      delta: 0.0,
      durationS: 30,
      metrics: 'tests=10',
      description: 'ralph: task 1',
      ...overrides,
    };
  }

  it('appendResult with stages writes 9 tab-separated columns with stages as 9th', () => {
    appendResult(makeEntry({ stages: 'unit:pass,integration:fail' }));
    const content = readFileSync('.ralph/results.tsv', 'utf8');
    const lines = content.split('\n').filter(l => l.trim() !== '');
    const dataLine = lines[1]!; // skip header
    const cols = dataLine.split('\t');
    expect(cols).toHaveLength(9);
    expect(cols[8]).toBe('unit:pass,integration:fail');
  });

  it('appendResult without stages writes "—" as 9th column', () => {
    appendResult(makeEntry());
    const content = readFileSync('.ralph/results.tsv', 'utf8');
    const lines = content.split('\n').filter(l => l.trim() !== '');
    const dataLine = lines[1]!;
    const cols = dataLine.split('\t');
    expect(cols).toHaveLength(9);
    expect(cols[8]).toBe('—');
  });

  it('header written on file creation includes "stages" as 9th column', () => {
    appendResult(makeEntry());
    const content = readFileSync('.ralph/results.tsv', 'utf8');
    const headerLine = content.split('\n')[0]!;
    const cols = headerLine.split('\t');
    expect(cols).toHaveLength(9);
    expect(cols[8]).toBe('stages');
  });

  it('readResults parsing 9-column TSV populates stages field correctly', () => {
    appendResult(makeEntry({ stages: 'unit:pass,typecheck:pass,integration:fail' }));
    const [r] = readResults();
    expect(r!.stages).toBe('unit:pass,typecheck:pass,integration:fail');
  });

  it('readResults parsing 8-column TSV returns stages as undefined', () => {
    // Write an 8-column TSV manually (old format without stages column)
    const header = 'commit\titeration\tstatus\tscore\tdelta\tduration_s\tmetrics\tdescription';
    const row = 'abc1234\t1\tpass\t0.8\t0.0\t30\ttests=10\tralph: task 1';
    writeFileSync('.ralph/results.tsv', `${header}\n${row}\n`, 'utf8');
    const [r] = readResults();
    expect(r!.stages).toBeUndefined();
  });

  it('readResults returns undefined for stages when 9th column is "—"', () => {
    appendResult(makeEntry()); // no stages → '—'
    const [r] = readResults();
    expect(r!.stages).toBeUndefined();
  });
});
