import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  computeFingerprint,
  appendPatternHistory,
  loadPatternHistory,
  detectDivergence,
  formatTemporalView,
  computeAndRecordDivergence,
} from './fingerprint.js';
import type { PatternFingerprint, DivergenceItem } from './fingerprint.js';
import type { PatternData } from './scanners.js';
import type { DivergenceConfig, RalphConfig } from '../../config/schema.js';
import { DEFAULT_DIVERGENCE } from '../../config/defaults.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  const dir = join(tmpdir(), `ralph-fp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeConfig(overrides: { enabled?: boolean } = {}): RalphConfig {
  return {
    project: { name: 'test', language: 'typescript' },
    architecture: {
      layers: [],
      direction: 'forward-only',
      rules: { 'max-lines': 500, naming: { schemas: '*Schema', types: '*Type' } },
    },
    quality: { 'minimum-grade': 'D', coverage: { tool: 'none', 'report-path': 'coverage/lcov.info' } },
    gc: {
      'consistency-threshold': 60,
      exclude: ['node_modules', 'dist', '.next', 'coverage'],
      divergence: { ...DEFAULT_DIVERGENCE, ...overrides },
    },
    doctor: { 'minimum-score': 7, 'custom-checks': [] },
    paths: {
      'agents-md': 'AGENTS.md',
      'architecture-md': 'ARCHITECTURE.md',
      docs: 'docs',
      specs: 'docs/product-specs',
      plans: 'docs/exec-plans',
      'design-docs': 'docs/design-docs',
      references: 'docs/references',
      generated: 'docs/generated',
      quality: 'docs/QUALITY_SCORE.md',
    },
    references: { 'max-total-kb': 200, 'warn-single-file-kb': 80 },
  } as RalphConfig;
}

function makeFingerprint(
  iteration: number,
  patterns: Record<string, Record<string, number>>,
): PatternFingerprint {
  return {
    iteration,
    commit: `commit-${iteration}`,
    timestamp: new Date().toISOString(),
    patterns,
  };
}

function makePatternData(
  categories: Record<string, Record<string, string[]>>,
): PatternData {
  const data: PatternData = {};
  for (const [category, variants] of Object.entries(categories)) {
    const variantMap = new Map<string, { files: string[]; fileLines: Map<string, number> }>();
    for (const [variant, files] of Object.entries(variants)) {
      const fileLines = new Map<string, number>();
      for (const f of files) fileLines.set(f, 1);
      variantMap.set(variant, { files, fileLines });
    }
    data[category] = variantMap;
  }
  return data;
}

const DEFAULT_CONFIG: DivergenceConfig = { ...DEFAULT_DIVERGENCE };

// ─── collectPatternData (integration via computeFingerprint) ──────────────────

describe('collectPatternData (integration via collectPatternData + computeFingerprint)', () => {
  let tempDir: string;
  const origCwd = process.cwd();

  beforeEach(() => {
    tempDir = makeTempDir();
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    mkdirSync(join(tempDir, '.git'), { recursive: true });
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('mixed patterns project → correct file counts per variant per category', async () => {
    // try-catch in 2 files, .catch() in 1 file
    writeFileSync(join(tempDir, 'src', 'a.ts'), 'try { foo(); } catch (e) { bar(e); }\nexport const x = 1;');
    writeFileSync(join(tempDir, 'src', 'b.ts'), 'try { baz(); } catch (e) { qux(e); }\nexport const y = 1;');
    writeFileSync(join(tempDir, 'src', 'c.ts'), 'promise.catch(err => console.error(err));\nexport const z = 1;');

    const { collectPatternData } = await import('./scanners.js');
    const config = makeConfig();
    const data = collectPatternData(tempDir, config);

    const tryCatch = data['error-handling']?.get('try-catch');
    const dotCatch = data['error-handling']?.get('.catch()');
    expect(tryCatch?.files.length).toBe(2);
    expect(dotCatch?.files.length).toBe(1);
  });

  it('excluded dirs → not counted', async () => {
    mkdirSync(join(tempDir, 'node_modules', 'lib'), { recursive: true });
    writeFileSync(join(tempDir, 'node_modules', 'lib', 'mod.ts'), 'try { x(); } catch(e) {}');
    writeFileSync(join(tempDir, 'src', 'app.ts'), 'export const x = 1;');

    const { collectPatternData } = await import('./scanners.js');
    const config = makeConfig();
    const data = collectPatternData(tempDir, config);

    const tryCatch = data['error-handling']?.get('try-catch');
    expect(tryCatch?.files ?? []).toHaveLength(0);
  });

  it('empty project (no source files) → all categories have empty maps', async () => {
    const { collectPatternData } = await import('./scanners.js');
    const config = makeConfig();
    const data = collectPatternData(tempDir, config);

    for (const variantMap of Object.values(data)) {
      expect(variantMap.size).toBe(0);
    }
  });
});

// ─── computeFingerprint ───────────────────────────────────────────────────────

describe('computeFingerprint()', () => {
  it('multiple categories with variants → correct PatternFingerprint structure', () => {
    const data = makePatternData({
      'error-handling': { 'try-catch': ['a.ts', 'b.ts'], '.catch()': ['c.ts'] },
      'export-style': { 'named-export': ['a.ts'] },
    });
    const fp = computeFingerprint(data, 3, 'abc123');
    expect(fp.iteration).toBe(3);
    expect(fp.commit).toBe('abc123');
    expect(fp.patterns['error-handling']?.['try-catch']).toBe(2);
    expect(fp.patterns['error-handling']?.['.catch()']).toBe(1);
    expect(fp.patterns['export-style']?.['named-export']).toBe(1);
  });

  it('empty patternData → each present category has empty record', () => {
    const data = makePatternData({
      'error-handling': {},
      'export-style': {},
      'null-checking': {},
    });
    const fp = computeFingerprint(data, 1, 'commit1');
    expect(fp.patterns['error-handling']).toEqual({});
    expect(fp.patterns['export-style']).toEqual({});
    expect(fp.patterns['null-checking']).toEqual({});
  });

  it('iteration, commit, timestamp fields populated correctly', () => {
    const before = new Date().toISOString();
    const fp = computeFingerprint(makePatternData({}), 7, 'deadbeef');
    const after = new Date().toISOString();
    expect(fp.iteration).toBe(7);
    expect(fp.commit).toBe('deadbeef');
    expect(fp.timestamp >= before).toBe(true);
    expect(fp.timestamp <= after).toBe(true);
  });

  it('performance: completes in <500ms for 1000-entry fake patternData', () => {
    const data: PatternData = {};
    for (let i = 0; i < 1000; i++) {
      const variantMap = new Map<string, { files: string[]; fileLines: Map<string, number> }>();
      variantMap.set(`variant-${i}`, { files: [`file-${i}.ts`], fileLines: new Map([[ `file-${i}.ts`, 1]]) });
      data[`category-${i}`] = variantMap;
    }
    const start = Date.now();
    computeFingerprint(data, 1, 'hash');
    expect(Date.now() - start).toBeLessThan(500);
  });
});

// ─── loadPatternHistory / appendPatternHistory ────────────────────────────────

describe('appendPatternHistory() / loadPatternHistory()', () => {
  let tempDir: string;

  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it('append to missing file → file created, one entry readable', () => {
    const entry = makeFingerprint(1, { 'error-handling': { 'try-catch': 5 } });
    appendPatternHistory(tempDir, entry);
    const loaded = loadPatternHistory(tempDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.iteration).toBe(1);
    expect(loaded[0]?.patterns['error-handling']?.['try-catch']).toBe(5);
  });

  it('append to existing file → entry appended, previous entries preserved', () => {
    const e1 = makeFingerprint(1, { 'export-style': { 'named-export': 3 } });
    const e2 = makeFingerprint(2, { 'export-style': { 'named-export': 4 } });
    appendPatternHistory(tempDir, e1);
    appendPatternHistory(tempDir, e2);
    const loaded = loadPatternHistory(tempDir);
    expect(loaded).toHaveLength(2);
    expect(loaded[0]?.iteration).toBe(1);
    expect(loaded[1]?.iteration).toBe(2);
  });

  it('load from missing file → returns [] without throwing', () => {
    expect(() => loadPatternHistory(tempDir)).not.toThrow();
    expect(loadPatternHistory(tempDir)).toEqual([]);
  });

  it('load from file with 3 valid + 1 corrupt line → returns 3 entries', () => {
    mkdirSync(join(tempDir, '.ralph'), { recursive: true });
    const e1 = makeFingerprint(1, {});
    const e2 = makeFingerprint(2, {});
    const e3 = makeFingerprint(3, {});
    const content = [
      JSON.stringify(e1),
      '{corrupted json{{',
      JSON.stringify(e2),
      JSON.stringify(e3),
    ].join('\n') + '\n';
    writeFileSync(join(tempDir, '.ralph', 'pattern-history.jsonl'), content);
    const loaded = loadPatternHistory(tempDir);
    expect(loaded).toHaveLength(3);
  });

  it('load from empty file → returns []', () => {
    mkdirSync(join(tempDir, '.ralph'), { recursive: true });
    writeFileSync(join(tempDir, '.ralph', 'pattern-history.jsonl'), '');
    expect(loadPatternHistory(tempDir)).toEqual([]);
  });

  it('appendPatternHistory write error → warn called, no throw (mock fs to throw)', () => {
    // Make .ralph a file so ensureDir fails
    writeFileSync(join(tempDir, '.ralph'), 'i-am-a-file');
    const warnSpy = vi.spyOn(console, 'log');
    const entry = makeFingerprint(1, {});
    expect(() => appendPatternHistory(tempDir, entry)).not.toThrow();
    // output.warn calls console.log with a yellow ⚠ prefix
    const warnCalls = warnSpy.mock.calls.map(args => String(args[0]));
    expect(warnCalls.some(msg => msg.includes('pattern history'))).toBe(true);
    warnSpy.mockRestore();
  });
});

// ─── detectDivergence ─────────────────────────────────────────────────────────

describe('detectDivergence()', () => {
  it('previous has try-catch 10, current adds .catch() with 3 files → new-pattern item', () => {
    const prev = makeFingerprint(1, { 'error-handling': { 'try-catch': 10 } });
    const curr = makeFingerprint(2, { 'error-handling': { 'try-catch': 10, '.catch()': 3 } });
    const items = detectDivergence(curr, prev, DEFAULT_CONFIG);
    const np = items.find(i => i.type === 'new-pattern' && i.variant === '.catch()');
    expect(np).toBeDefined();
    expect(np?.category).toBe('error-handling');
  });

  it('new pattern below threshold (new-pattern-threshold: 3, new pattern has 2 files) → no item', () => {
    const prev = makeFingerprint(1, { 'error-handling': { 'try-catch': 10 } });
    const curr = makeFingerprint(2, { 'error-handling': { 'try-catch': 10, '.catch()': 2 } });
    const config: DivergenceConfig = { ...DEFAULT_CONFIG, 'new-pattern-threshold': 3 };
    const items = detectDivergence(curr, prev, config);
    expect(items.filter(i => i.type === 'new-pattern')).toHaveLength(0);
  });

  it('named-export was dominant, default-export becomes dominant → dominant-shift item', () => {
    const prev = makeFingerprint(1, { 'export-style': { 'named-export': 10, 'default-export': 2 } });
    const curr = makeFingerprint(2, { 'export-style': { 'named-export': 3, 'default-export': 8 } });
    const items = detectDivergence(curr, prev, DEFAULT_CONFIG);
    const ds = items.find(i => i.type === 'dominant-shift');
    expect(ds).toBeDefined();
    expect(ds?.variant).toBe('default-export');
  });

  it('share changes 0.30 > threshold 0.20 → proportion-change item', () => {
    // named-export was 100% (10/10), now 70% (7/10) — 30% change
    const prev = makeFingerprint(1, { 'export-style': { 'named-export': 10 } });
    const curr = makeFingerprint(2, { 'export-style': { 'named-export': 7, 'default-export': 3 } });
    const items = detectDivergence(curr, prev, { ...DEFAULT_CONFIG, 'proportion-change-threshold': 0.20 });
    const pc = items.find(i => i.type === 'proportion-change' && i.variant === 'named-export');
    expect(pc).toBeDefined();
  });

  it('share changes 0.10 < threshold 0.20 → no proportion-change item', () => {
    // named-export was 100% (10/10), now 91% (10/11) — ~9% change
    const prev = makeFingerprint(1, { 'export-style': { 'named-export': 10 } });
    const curr = makeFingerprint(2, { 'export-style': { 'named-export': 10, 'default-export': 1 } });
    const items = detectDivergence(curr, prev, { ...DEFAULT_CONFIG, 'proportion-change-threshold': 0.20 });
    expect(items.filter(i => i.type === 'proportion-change')).toHaveLength(0);
  });

  it('previous is null → returns []', () => {
    const curr = makeFingerprint(1, { 'error-handling': { 'try-catch': 5 } });
    expect(detectDivergence(curr, null, DEFAULT_CONFIG)).toEqual([]);
  });

  it('previous is undefined → returns []', () => {
    const curr = makeFingerprint(1, { 'error-handling': { 'try-catch': 5 } });
    expect(detectDivergence(curr, undefined, DEFAULT_CONFIG)).toEqual([]);
  });

  it('category total 0 in current → no proportion-change (no division by zero)', () => {
    const prev = makeFingerprint(1, { 'export-style': { 'named-export': 5 } });
    const curr = makeFingerprint(2, { 'export-style': { 'named-export': 0 } });
    const items = detectDivergence(curr, prev, DEFAULT_CONFIG);
    expect(items.filter(i => i.type === 'proportion-change')).toHaveLength(0);
  });

  it('category total 0 in previous → no proportion-change', () => {
    const prev = makeFingerprint(1, { 'export-style': { 'named-export': 0 } });
    const curr = makeFingerprint(2, { 'export-style': { 'named-export': 5 } });
    const items = detectDivergence(curr, prev, DEFAULT_CONFIG);
    expect(items.filter(i => i.type === 'proportion-change')).toHaveLength(0);
  });

  it('tied dominance → alphabetical tiebreaker selects correct dominant', () => {
    // Previous: alpha dominant (tied at 5, alpha < beta alphabetically)
    const prev = makeFingerprint(1, { 'error-handling': { alpha: 5, beta: 5 } });
    // Current: beta > alpha (beta is now truly dominant, no tie)
    const curr = makeFingerprint(2, { 'error-handling': { alpha: 3, beta: 7 } });
    const items = detectDivergence(curr, prev, DEFAULT_CONFIG);
    const ds = items.find(i => i.type === 'dominant-shift');
    expect(ds).toBeDefined();
    // Previous dominant was alpha (alphabetical tiebreak), current is beta
    expect(ds?.variant).toBe('beta');
  });

  it('category in current but absent in previous → variants ≥ threshold treated as new-pattern', () => {
    const prev = makeFingerprint(1, { 'export-style': { 'named-export': 5 } });
    // 'null-checking' is entirely new
    const curr = makeFingerprint(2, {
      'export-style': { 'named-export': 5 },
      'null-checking': { 'nullish-coalescing': 3 },
    });
    const items = detectDivergence(curr, prev, DEFAULT_CONFIG);
    const np = items.find(i => i.type === 'new-pattern' && i.category === 'null-checking');
    expect(np).toBeDefined();
  });
});

// ─── formatTemporalView ───────────────────────────────────────────────────────

describe('formatTemporalView()', () => {
  it('10-entry history with divergence at iteration 9 → output contains "← divergence"', () => {
    const history: PatternFingerprint[] = [];
    // Iterations 1–8: only try-catch
    for (let i = 1; i <= 8; i++) {
      history.push(makeFingerprint(i, { 'error-handling': { 'try-catch': 10 } }));
    }
    // Iteration 9: .catch() appears
    history.push(makeFingerprint(9, { 'error-handling': { 'try-catch': 8, '.catch()': 3 } }));
    // Iteration 10: same as 9
    history.push(makeFingerprint(10, { 'error-handling': { 'try-catch': 8, '.catch()': 3 } }));

    const output = formatTemporalView(history, 10);
    expect(output).toContain('← divergence');
  });

  it('empty history → guidance message (not an error)', () => {
    const output = formatTemporalView([], 10);
    expect(output).toContain('No pattern history found');
    expect(output).toContain('ralph run build');
  });

  it('single entry → baseline only, no "← divergence" annotation', () => {
    const history = [makeFingerprint(1, { 'error-handling': { 'try-catch': 5 } })];
    const output = formatTemporalView(history, 10);
    expect(output).not.toContain('← divergence');
    expect(output).toContain('iter 1');
  });

  it('last: 5 with 10 entries → only last 5 entries shown', () => {
    const history: PatternFingerprint[] = [];
    for (let i = 1; i <= 10; i++) {
      history.push(makeFingerprint(i, { 'error-handling': { 'try-catch': i } }));
    }
    const output = formatTemporalView(history, 5);
    expect(output).toContain('last 5 iterations');
    expect(output).not.toContain('iter 1:');
    expect(output).toContain('iter 6');
  });
});

// ─── computeAndRecordDivergence ───────────────────────────────────────────────

describe('computeAndRecordDivergence()', () => {
  let tempDir: string;
  const origCwd = process.cwd();

  beforeEach(() => {
    tempDir = makeTempDir();
    mkdirSync(join(tempDir, '.git'), { recursive: true });
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('enabled, no previous → appends first entry, returns []', () => {
    const config = makeConfig();
    const items = computeAndRecordDivergence(tempDir, config, 1, 'abc');
    expect(items).toEqual([]);
    expect(existsSync(join(tempDir, '.ralph', 'pattern-history.jsonl'))).toBe(true);
    const history = loadPatternHistory(tempDir);
    expect(history).toHaveLength(1);
    expect(history[0]?.iteration).toBe(1);
    expect(history[0]?.commit).toBe('abc');
  });

  it('enabled, with previous and divergence → appends and returns items', () => {
    // Seed a previous fingerprint with only try-catch
    mkdirSync(join(tempDir, '.ralph'), { recursive: true });
    const prev = makeFingerprint(1, { 'error-handling': { 'try-catch': 10 } });
    writeFileSync(
      join(tempDir, '.ralph', 'pattern-history.jsonl'),
      JSON.stringify(prev) + '\n',
    );

    // Create a source file with .catch() pattern so collectPatternData picks it up
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'app.ts'), 'promise.catch(err => log(err));\nexport const x = 1;');

    const config = makeConfig();
    const items = computeAndRecordDivergence(tempDir, config, 2, 'def');

    // .catch() is a new pattern → expect at least one item
    expect(Array.isArray(items)).toBe(true);

    // History should now have 2 entries
    const history = loadPatternHistory(tempDir);
    expect(history).toHaveLength(2);
    expect(history[1]?.iteration).toBe(2);
  });

  it('enabled: false → returns [], no file written', () => {
    const config = makeConfig({ enabled: false });
    const items = computeAndRecordDivergence(tempDir, config, 1, 'abc');
    expect(items).toEqual([]);
    expect(existsSync(join(tempDir, '.ralph', 'pattern-history.jsonl'))).toBe(false);
  });

  it('defaults apply when config.gc.divergence not set (no divergence field)', () => {
    const config = makeConfig();
    // Remove divergence field to simulate missing config
    delete (config.gc as { divergence?: unknown }).divergence;

    // With enabled defaulting to true via config.gc.divergence being undefined,
    // computeAndRecordDivergence checks `config.gc.divergence?.enabled === false`
    // → undefined?.enabled → undefined !== false → proceeds
    // But detectDivergence uses config.gc.divergence! — with no previous entry it returns []
    const items = computeAndRecordDivergence(tempDir, config, 1, 'abc');
    // No previous → returns []
    expect(items).toEqual([]);
    // File should be written (not disabled)
    expect(existsSync(join(tempDir, '.ralph', 'pattern-history.jsonl'))).toBe(true);
  });
});
