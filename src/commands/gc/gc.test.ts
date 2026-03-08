import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gcCommand } from './index.js';

function makeTempDir(): string {
  const dir = join(tmpdir(), `ralph-gc-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function captureJson(fn: () => void): Record<string, unknown> {
  const originalLog = console.log;
  let output = '';
  console.log = (msg: string) => { output += msg; };
  fn();
  console.log = originalLog;
  return JSON.parse(output) as Record<string, unknown>;
}

function captureText(fn: () => void): string {
  const originalLog = console.log;
  const originalWarn = console.warn;
  let output = '';
  console.log = (msg: string) => { output += msg + '\n'; };
  // Suppress picocolors warn output
  fn();
  console.log = originalLog;
  console.warn = originalWarn;
  return output;
}

describe('gc command', () => {
  let tempDir: string;
  const origCwd = process.cwd();

  beforeEach(() => {
    tempDir = makeTempDir();
    mkdirSync(join(tempDir, '.git'), { recursive: true });
    mkdirSync(join(tempDir, '.ralph'), { recursive: true });
    writeFileSync(join(tempDir, '.ralph', 'config.yml'), 'project:\n  name: test\n  language: typescript\n');
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('produces JSON output with --json', () => {
    const result = captureJson(() => gcCommand({ json: true }));
    expect(result.items).toBeDefined();
    expect(result.summary).toBeDefined();
    expect(typeof (result.summary as Record<string, unknown>).total).toBe('number');
  });

  it('writes gc-report.md', () => {
    gcCommand({});
    expect(existsSync(join(tempDir, '.ralph', 'gc-report.md'))).toBe(true);
  });

  it('detects stale doc references', () => {
    mkdirSync(join(tempDir, 'docs'), { recursive: true });
    writeFileSync(join(tempDir, 'docs', 'README.md'), 'See `src/nonexistent/file.ts` for details.');

    const result = captureJson(() => gcCommand({ json: true }));
    const staleItems = (result.items as Array<{ category: string }>).filter(i => i.category === 'stale-documentation');
    expect(staleItems.length).toBeGreaterThan(0);
  });

  it('filters by severity', () => {
    const result = captureJson(() => gcCommand({ json: true, severity: 'critical' }));
    for (const item of result.items as Array<{ severity: string }>) {
      expect(item.severity).toBe('critical');
    }
  });

  it('filters by category', () => {
    mkdirSync(join(tempDir, 'docs'), { recursive: true });
    writeFileSync(join(tempDir, 'docs', 'README.md'), 'See `src/gone/file.ts` for details.');
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'orphan.ts'), 'export function unused() { return 42; }\n');

    const result = captureJson(() => gcCommand({ json: true, category: 'stale-documentation' }));
    const items = result.items as Array<{ category: string }>;
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.category).toBe('stale-documentation');
    }
  });

  it('detects exports with no importers', () => {
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'orphan.ts'),
      `export function unusedHelper() { return 42; }\n`
    );
    writeFileSync(join(tempDir, 'src', 'main.ts'),
      `export function main() { console.log('hello'); }\n`
    );

    const result = captureJson(() => gcCommand({ json: true }));
    const deadItems = (result.items as Array<{ category: string; file: string }>).filter(i => i.category === 'dead-code');
    const orphanItem = deadItems.find(i => i.file.includes('orphan'));
    expect(orphanItem).toBeDefined();
  });

  it('does not flag files that are imported', () => {
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'helper.ts'),
      `export function helper() { return 42; }\n`
    );
    writeFileSync(join(tempDir, 'src', 'app.ts'),
      `import { helper } from './helper.js';\nexport function run() { return helper(); }\n`
    );

    const result = captureJson(() => gcCommand({ json: true }));
    const deadItems = (result.items as Array<{ category: string; file: string }>).filter(i =>
      i.category === 'dead-code' && i.file.includes('helper'));
    expect(deadItems.length).toBe(0);
  });

  it('detects orphaned test files', () => {
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'deleted.test.ts'),
      `import { describe, it } from 'vitest';\ndescribe('deleted', () => { it('works', () => {}); });\n`
    );

    const result = captureJson(() => gcCommand({ json: true }));
    const deadItems = (result.items as Array<{ category: string; file: string; description: string }>).filter(i =>
      i.category === 'dead-code' && i.file.includes('deleted.test'));
    expect(deadItems.length).toBe(1);
    expect(deadItems[0]!.description).toContain('no corresponding source');
  });

  it('includes git context in dead code description when available', () => {
    // Initialize a git repo so git log can find history
    execSync('git init', { cwd: tempDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'pipe' });

    mkdirSync(join(tempDir, 'src'), { recursive: true });
    // Create orphan file and a consumer that imports it
    writeFileSync(join(tempDir, 'src', 'utils.ts'),
      `export function helper() { return 42; }\n`
    );
    writeFileSync(join(tempDir, 'src', 'app.ts'),
      `import { helper } from './utils.js';\nexport function run() { return helper(); }\n`
    );
    execSync('git add -A && git commit -m "initial"', { cwd: tempDir, stdio: 'pipe' });

    // Remove the import so utils.ts becomes orphaned
    writeFileSync(join(tempDir, 'src', 'app.ts'),
      `export function run() { return 'no imports'; }\n`
    );
    execSync('git add -A && git commit -m "remove import"', { cwd: tempDir, stdio: 'pipe' });

    const result = captureJson(() => gcCommand({ json: true }));
    const deadItems = (result.items as Array<{ category: string; file: string; description: string }>).filter(i =>
      i.category === 'dead-code' && i.file.includes('utils'));
    expect(deadItems.length).toBe(1);
    // Should contain git reference context
    expect(deadItems[0]!.description).toMatch(/last referenced in commit \w+/);
  });

  it('produces fix-descriptions markdown file', () => {
    mkdirSync(join(tempDir, 'docs'), { recursive: true });
    writeFileSync(join(tempDir, 'docs', 'README.md'), 'See `src/gone/file.ts` for details.');

    const output = captureText(() => gcCommand({ fixDescriptions: true }));
    expect(output).toContain('Generated fix descriptions');

    const fixFile = readFileSync(join(tempDir, '.ralph', 'gc-fix-descriptions.md'), 'utf-8');
    expect(fixFile).toContain('Fix Descriptions');
    expect(fixFile).toContain('- [ ]');
    expect(fixFile).toContain('Fix:');
  });

  // --- Golden principle violations tests ---

  it('detects empty catch blocks as principle violations', () => {
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'bad.ts'),
      `export function doStuff() {\n  try {\n    riskyCall();\n  } catch (e) {}\n}\n`
    );

    const result = captureJson(() => gcCommand({ json: true }));
    const violations = (result.items as Array<{ category: string; file: string; description: string }>).filter(i =>
      i.category === 'principle-violation' && i.file.includes('bad'));
    expect(violations.length).toBeGreaterThan(0);
    const emptyCatch = violations.find(v => v.description.includes('Empty catch'));
    expect(emptyCatch).toBeDefined();
    expect(emptyCatch!.description).toContain('occurrence');
  });

  it('detects any type usage as principle violations', () => {
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'typed.ts'),
      `export function parse(data: any) {\n  return data as any;\n}\n`
    );

    const result = captureJson(() => gcCommand({ json: true }));
    const violations = (result.items as Array<{ category: string; file: string; description: string }>).filter(i =>
      i.category === 'principle-violation' && i.file.includes('typed'));
    const anyViolation = violations.find(v => v.description.includes('any'));
    expect(anyViolation).toBeDefined();
  });

  it('detects deep optional chaining as data probing', () => {
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'probe.ts'),
      `export function extract(data: unknown) {\n  return data?.response?.body?.items?.length;\n}\n`
    );

    const result = captureJson(() => gcCommand({ json: true }));
    const violations = (result.items as Array<{ category: string; file: string; description: string }>).filter(i =>
      i.category === 'principle-violation' && i.file.includes('probe'));
    const probeViolation = violations.find(v => v.description.includes('optional chaining'));
    expect(probeViolation).toBeDefined();
  });

  it('matches violations to principles from core-beliefs.md', () => {
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    mkdirSync(join(tempDir, 'docs', 'design-docs'), { recursive: true });

    writeFileSync(join(tempDir, 'docs', 'design-docs', 'core-beliefs.md'),
      `# Core Beliefs\n\n1. Never swallow errors — always handle or re-throw\n2. Use strict typing everywhere\n`
    );

    writeFileSync(join(tempDir, 'src', 'swallow.ts'),
      `export function risky() {\n  try { doStuff(); } catch (e) {}\n}\n`
    );

    const result = captureJson(() => gcCommand({ json: true }));
    const violations = (result.items as Array<{ category: string; description: string }>).filter(i =>
      i.category === 'principle-violation');
    const matched = violations.find(v => v.description.includes('Principle:'));
    expect(matched).toBeDefined();
    expect(matched!.description).toContain('swallow');
  });

  it('skips principle violations in comments', () => {
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'commented.ts'),
      `// Note: don't use catch (e) {} empty blocks\nexport function clean() { return 1; }\n`
    );

    const result = captureJson(() => gcCommand({ json: true }));
    const violations = (result.items as Array<{ category: string; file: string }>).filter(i =>
      i.category === 'principle-violation' && i.file.includes('commented'));
    // empty-catch pattern should not match comment lines
    const emptyCatch = violations.find(v => (v as unknown as { description: string }).description.includes('Empty catch'));
    expect(emptyCatch).toBeUndefined();
  });

  it('skips test files for principle violations', () => {
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'bad.test.ts'),
      `import { describe, it } from 'vitest';\ndescribe('test', () => { it('ok', () => { const x: any = 1; }); });\n`
    );

    const result = captureJson(() => gcCommand({ json: true }));
    const violations = (result.items as Array<{ category: string; file: string }>).filter(i =>
      i.category === 'principle-violation' && i.file.includes('bad.test'));
    expect(violations.length).toBe(0);
  });

  // --- Expanded pattern consistency tests ---

  it('detects export style inconsistency', () => {
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    // Create files with mixed export styles (default threshold is 60%)
    // 3 default + 3 named = 50% dominance, below 60% threshold
    writeFileSync(join(tempDir, 'src', 'a.ts'), `export default function a() { return 1; }\n`);
    writeFileSync(join(tempDir, 'src', 'b.ts'), `export default function b() { return 2; }\n`);
    writeFileSync(join(tempDir, 'src', 'c.ts'), `export default function c() { return 3; }\n`);
    writeFileSync(join(tempDir, 'src', 'd.ts'), `export function d() { return 4; }\n`);
    writeFileSync(join(tempDir, 'src', 'e.ts'), `export function e() { return 5; }\n`);
    writeFileSync(join(tempDir, 'src', 'f.ts'), `export function f() { return 6; }\n`);

    const result = captureJson(() => gcCommand({ json: true }));
    const patterns = (result.items as Array<{ category: string; description: string }>).filter(i =>
      i.category === 'pattern-inconsistency' && i.description.includes('export-style'));
    // Should detect mixed export styles
    expect(patterns.length).toBeGreaterThan(0);
  });

  it('pattern inconsistency includes line numbers', () => {
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    // 3 default + 3 named = 50% dominance, below 60% threshold
    writeFileSync(join(tempDir, 'src', 'a.ts'), `const x = 1;\nexport default function a() { return 1; }\n`);
    writeFileSync(join(tempDir, 'src', 'b.ts'), `export default function b() { return 2; }\n`);
    writeFileSync(join(tempDir, 'src', 'c.ts'), `export default function c() { return 3; }\n`);
    writeFileSync(join(tempDir, 'src', 'd.ts'), `export function d() { return 4; }\n`);
    writeFileSync(join(tempDir, 'src', 'e.ts'), `export function e() { return 5; }\n`);
    writeFileSync(join(tempDir, 'src', 'f.ts'), `export function f() { return 6; }\n`);

    const result = captureJson(() => gcCommand({ json: true }));
    const patterns = (result.items as Array<{ category: string; line?: number }>).filter(i =>
      i.category === 'pattern-inconsistency');
    // Pattern inconsistency items should have line numbers
    expect(patterns.length).toBeGreaterThan(0);
    for (const p of patterns) {
      expect(p.line).toBeDefined();
      expect(typeof p.line).toBe('number');
      expect(p.line).toBeGreaterThan(0);
    }
  });

  // --- Trend tracking tests ---

  it('saves gc-history.jsonl after each run', () => {
    gcCommand({});
    const historyPath = join(tempDir, '.ralph', 'gc-history.jsonl');
    expect(existsSync(historyPath)).toBe(true);
    const content = readFileSync(historyPath, 'utf-8').trim();
    const entry = JSON.parse(content);
    expect(entry.timestamp).toBeDefined();
    expect(typeof entry.total).toBe('number');
    expect(typeof entry.critical).toBe('number');
    expect(typeof entry.warning).toBe('number');
    expect(typeof entry.info).toBe('number');
    expect(entry.categories).toBeDefined();
  });

  it('appends to existing history', () => {
    gcCommand({});
    gcCommand({});
    const historyPath = join(tempDir, '.ralph', 'gc-history.jsonl');
    const lines = readFileSync(historyPath, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(2);
  });

  it('detects rising drift trend', () => {
    // Seed history with rising values
    const historyPath = join(tempDir, '.ralph', 'gc-history.jsonl');
    const entries = [
      { timestamp: '2026-03-01T00:00:00Z', total: 2, critical: 0, warning: 1, info: 1, categories: {} },
      { timestamp: '2026-03-02T00:00:00Z', total: 5, critical: 1, warning: 2, info: 2, categories: {} },
    ];
    writeFileSync(historyPath, entries.map(e => JSON.stringify(e)).join('\n') + '\n');

    // Create source files that will generate more than 5 drift items
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    for (let i = 0; i < 8; i++) {
      writeFileSync(join(tempDir, 'src', `file${i}.ts`),
        `export function fn${i}() {\n  try { doStuff(); } catch (e) {}\n}\n`
      );
    }

    const result = captureJson(() => gcCommand({ json: true }));
    expect(result.trend).toBeDefined();
    const trend = result.trend as { direction: string; message: string };
    expect(trend.direction).toBe('rising');
    expect(trend.message).toContain('rising');
  });

  it('detects declining drift trend', () => {
    const historyPath = join(tempDir, '.ralph', 'gc-history.jsonl');
    const entries = [
      { timestamp: '2026-03-01T00:00:00Z', total: 10, critical: 2, warning: 4, info: 4, categories: {} },
      { timestamp: '2026-03-02T00:00:00Z', total: 5, critical: 1, warning: 2, info: 2, categories: {} },
    ];
    writeFileSync(historyPath, entries.map(e => JSON.stringify(e)).join('\n') + '\n');

    // Current run will produce 0 items (empty project) — declining
    const result = captureJson(() => gcCommand({ json: true }));
    expect(result.trend).toBeDefined();
    const trend = result.trend as { direction: string; message: string };
    expect(trend.direction).toBe('declining');
  });

  it('shows trend in text output', () => {
    const historyPath = join(tempDir, '.ralph', 'gc-history.jsonl');
    const entries = [
      { timestamp: '2026-03-01T00:00:00Z', total: 10, critical: 2, warning: 4, info: 4, categories: {} },
      { timestamp: '2026-03-02T00:00:00Z', total: 5, critical: 1, warning: 2, info: 2, categories: {} },
    ];
    writeFileSync(historyPath, entries.map(e => JSON.stringify(e)).join('\n') + '\n');

    const output = captureText(() => gcCommand({}));
    expect(output).toContain('declining');
  });

  it('includes trend in JSON output', () => {
    const result = captureJson(() => gcCommand({ json: true }));
    // With only 1 entry in history (just the current run), no trend yet
    expect(result.trend).toBeNull();
  });

  // --- User-defined anti-patterns tests ---

  it('loads and applies custom anti-patterns from .ralph/gc-patterns/', () => {
    mkdirSync(join(tempDir, '.ralph', 'gc-patterns'), { recursive: true });
    mkdirSync(join(tempDir, 'src'), { recursive: true });

    // Define a custom anti-pattern that detects eval() usage in code
    writeFileSync(join(tempDir, '.ralph', 'gc-patterns', 'no-eval.yml'),
      `name: no-eval\npattern: '\\beval\\s*\\('\nkeywords:\n  - security\n  - eval\ndescription: Uses eval() which is a security risk\nseverity: critical\nfix: Replace eval() with a safer alternative like JSON.parse or Function constructor\n`
    );

    writeFileSync(join(tempDir, 'src', 'unsafe.ts'),
      `export function run(code: string) {\n  return eval(code);\n}\n`
    );

    const result = captureJson(() => gcCommand({ json: true }));
    const violations = (result.items as Array<{ category: string; file: string; description: string }>).filter(i =>
      i.category === 'principle-violation' && i.file.includes('unsafe'));
    const evalViolation = violations.find(v => v.description.includes('eval()'));
    expect(evalViolation).toBeDefined();
    expect(evalViolation!.description).toContain('occurrence');
  });

  it('ignores malformed custom anti-pattern files', () => {
    mkdirSync(join(tempDir, '.ralph', 'gc-patterns'), { recursive: true });

    // Missing required 'pattern' field
    writeFileSync(join(tempDir, '.ralph', 'gc-patterns', 'bad.yml'), `name: bad-rule\n`);

    // Should not crash
    const result = captureJson(() => gcCommand({ json: true }));
    expect(result.items).toBeDefined();
  });

  it('matches new promote format principles in core-beliefs.md', () => {
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    mkdirSync(join(tempDir, 'docs', 'design-docs'), { recursive: true });

    // New promote format: - **principle.** Added DATE.
    writeFileSync(join(tempDir, 'docs', 'design-docs', 'core-beliefs.md'),
      `# Core Beliefs\n\n- **Never swallow errors.** Added 2026-03-07.\n`
    );

    writeFileSync(join(tempDir, 'src', 'swallow.ts'),
      `export function risky() {\n  try { doStuff(); } catch (e) {}\n}\n`
    );

    const result = captureJson(() => gcCommand({ json: true }));
    const violations = (result.items as Array<{ category: string; description: string }>).filter(i =>
      i.category === 'principle-violation');
    const matched = violations.find(v => v.description.includes('Principle:'));
    expect(matched).toBeDefined();
    expect(matched!.description).toContain('swallow');
  });

  it('warns on invalid --category value', () => {
    const output = captureText(() => gcCommand({ category: 'nonexistent' }));
    expect(output).toContain('Unknown category');
    expect(output).toContain('nonexistent');
    expect(output).toContain('principle-violation');
  });

  it('returns error JSON on invalid --category in JSON mode', () => {
    const result = captureJson(() => gcCommand({ json: true, category: 'invalid-cat' }));
    expect(result.error).toBeDefined();
    expect(String(result.error)).toContain('Unknown category');
  });

  it('stores item fingerprints in history for cross-run dedup', () => {
    mkdirSync(join(tempDir, 'docs'), { recursive: true });
    writeFileSync(join(tempDir, 'docs', 'README.md'), 'See `src/gone.ts` for details.');

    gcCommand({});

    const historyPath = join(tempDir, '.ralph', 'gc-history.jsonl');
    const content = readFileSync(historyPath, 'utf-8').trim();
    const entry = JSON.parse(content);
    expect(entry.itemKeys).toBeDefined();
    expect(Array.isArray(entry.itemKeys)).toBe(true);
    expect(entry.itemKeys.length).toBeGreaterThan(0);
    expect(entry.itemKeys[0]).toContain('stale-documentation');
  });

  it('flags persistent drift items across runs', () => {
    mkdirSync(join(tempDir, 'docs'), { recursive: true });
    writeFileSync(join(tempDir, 'docs', 'README.md'), 'See `src/gone.ts` for details.');

    // Run twice to build history
    gcCommand({});
    const result = captureJson(() => gcCommand({ json: true }));

    const items = result.items as Array<{ persistentRuns?: number; category: string }>;
    const staleItems = items.filter(i => i.category === 'stale-documentation');
    expect(staleItems.length).toBeGreaterThan(0);
    // Item appeared in previous run, so persistentRuns should be 2
    expect(staleItems[0]!.persistentRuns).toBe(2);
  });

  it('reports persistent count in JSON summary', () => {
    mkdirSync(join(tempDir, 'docs'), { recursive: true });
    writeFileSync(join(tempDir, 'docs', 'README.md'), 'See `src/gone.ts` for details.');

    gcCommand({});
    const result = captureJson(() => gcCommand({ json: true }));

    const summary = result.summary as { persistent: number };
    expect(summary.persistent).toBeGreaterThan(0);
  });

  it('shows persistent tag in text output', () => {
    mkdirSync(join(tempDir, 'docs'), { recursive: true });
    writeFileSync(join(tempDir, 'docs', 'README.md'), 'See `src/gone.ts` for details.');

    gcCommand({});
    const output = captureText(() => gcCommand({}));
    expect(output).toContain('[persistent: 2 runs]');
  });

  it('tracks category counts in history', () => {
    mkdirSync(join(tempDir, 'docs'), { recursive: true });
    writeFileSync(join(tempDir, 'docs', 'README.md'), 'See `src/deleted.ts` for details.');

    gcCommand({});

    const historyPath = join(tempDir, '.ralph', 'gc-history.jsonl');
    const content = readFileSync(historyPath, 'utf-8').trim();
    const entry = JSON.parse(content);
    expect(entry.categories['stale-documentation']).toBeGreaterThan(0);
  });
});
