import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { runDefaultScorer } from './default-scorer.js';
import type { RalphConfig } from '../../config/schema.js';

function makeConfig(coveragePath: string, overrides?: Partial<RalphConfig>): RalphConfig {
  return {
    project: { name: 'test', path: '.' },
    architecture: { layers: [], domains: [], rules: [] },
    quality: {
      coverage: { 'report-path': coveragePath, minimum: 0 },
      'min-grade': 'C',
      'per-domain': {},
    },
    run: {
      agent: { cli: 'claude', args: ['--print'], timeout: 1800 },
      'plan-agent': null,
      'build-agent': null,
      prompts: { plan: null, build: null },
      loop: { 'max-iterations': 0, 'stall-threshold': 3, 'iteration-timeout': 900 },
      validation: { 'test-command': null, 'typecheck-command': null },
      git: { 'auto-commit': true, 'auto-push': false, 'commit-prefix': 'ralph:', branch: null },
    },
    review: {
      agent: null,
      scope: 'staged',
      context: { 'include-specs': true, 'include-architecture': true, 'include-diff-context': 5, 'max-diff-lines': 2000 },
      output: { format: 'text', file: null, 'severity-threshold': 'info' },
    },
    heal: {
      agent: null,
      commands: ['doctor', 'grade', 'gc', 'lint'],
      'auto-commit': true,
      'commit-prefix': 'ralph: heal',
    },
    gc: { exclude: [], 'max-age-days': 90 },
    promote: { 'min-violations': 3, 'escalation-path': [] },
    doctor: { 'check-interval-days': 7 },
    ...overrides,
  } as unknown as RalphConfig;
}

describe('runDefaultScorer', () => {
  let tmpDir: string;
  let origCwd: string;

  beforeEach(() => {
    origCwd = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), 'ralph-default-scorer-test-'));
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('extracts test count from "X passed" pattern', () => {
    const config = makeConfig('no-coverage.json');
    const result = runDefaultScorer('50 passed (2.1s)', config);
    expect(result.metrics['test_count']).toBe('50');
    expect(result.metrics['test_total']).toBe('50');
    expect(result.score).toBeCloseTo(1.0, 4);
  });

  it('computes weighted score given test output and coverage data', () => {
    const coveragePath = join(tmpDir, 'coverage.json');
    writeFileSync(coveragePath, JSON.stringify({ total: { statements: { pct: 80.0 } } }));
    const config = makeConfig(coveragePath);
    // test_rate=1.0 (100 passed, no failed), coverage=0.8
    // score = 1.0 * 0.6 + 0.8 * 0.4 = 0.92
    const result = runDefaultScorer('100 passed', config);
    expect(result.score).toBeCloseTo(0.92, 4);
    expect(result.source).toBe('default');
    expect(result.scriptPath).toBeNull();
  });

  it('returns null score when no test output and no coverage file', () => {
    const config = makeConfig(join(tmpDir, 'missing.json'));
    const result = runDefaultScorer('', config);
    expect(result.score).toBeNull();
    expect(result.source).toBe('default');
  });

  it('returns test-only score when test output present but no coverage file', () => {
    const config = makeConfig(join(tmpDir, 'missing.json'));
    const result = runDefaultScorer('80 passed\n20 failed', config);
    // test_rate = 80/100 = 0.8, no coverage → score = 0.8
    expect(result.score).toBeCloseTo(0.8, 4);
    expect(result.metrics['coverage']).toBe('0');
  });

  it('boundary: 0 tests passed out of non-zero total → score 0', () => {
    const config = makeConfig(join(tmpDir, 'missing.json'));
    // 0 passed, 10 failed → test_rate = 0/10 = 0.0
    const result = runDefaultScorer('0 passed\n10 failed', config);
    expect(result.metrics['test_rate']).toBe('0.0000');
    expect(result.score).toBeCloseTo(0.0, 4);
  });

  it('boundary: coverage at 100% contributes maximum to score', () => {
    const coveragePath = join(tmpDir, 'coverage.json');
    writeFileSync(coveragePath, JSON.stringify({ total: { statements: { pct: 100.0 } } }));
    const config = makeConfig(coveragePath);
    // test_rate=1.0, coverage=1.0 → score = 1.0 * 0.6 + 1.0 * 0.4 = 1.0
    const result = runDefaultScorer('100 passed', config);
    expect(result.score).toBeCloseTo(1.0, 4);
    expect(result.metrics['coverage']).toBe('1.0000');
  });
});
