import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gcCommand } from './index.js';

function makeTempDir(): string {
  const dir = join(tmpdir(), `ralph-gc-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
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
    const originalLog = console.log;
    let output = '';
    console.log = (msg: string) => { output += msg; };

    gcCommand({ json: true });

    console.log = originalLog;
    const result = JSON.parse(output);
    expect(result.items).toBeDefined();
    expect(result.summary).toBeDefined();
    expect(typeof result.summary.total).toBe('number');
  });

  it('writes gc-report.md', () => {
    gcCommand({});
    expect(existsSync(join(tempDir, '.ralph', 'gc-report.md'))).toBe(true);
  });

  it('detects stale doc references', () => {
    mkdirSync(join(tempDir, 'docs'), { recursive: true });
    writeFileSync(join(tempDir, 'docs', 'README.md'), 'See `src/nonexistent/file.ts` for details.');

    const originalLog = console.log;
    let output = '';
    console.log = (msg: string) => { output += msg; };

    gcCommand({ json: true });

    console.log = originalLog;
    const result = JSON.parse(output);
    const staleItems = result.items.filter((i: { category: string }) => i.category === 'stale-documentation');
    expect(staleItems.length).toBeGreaterThan(0);
  });

  it('filters by severity', () => {
    const originalLog = console.log;
    let output = '';
    console.log = (msg: string) => { output += msg; };

    gcCommand({ json: true, severity: 'critical' });

    console.log = originalLog;
    const result = JSON.parse(output);
    for (const item of result.items) {
      expect(item.severity).toBe('critical');
    }
  });

  it('detects exports with no importers', () => {
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    // Create a file that exports but is never imported
    writeFileSync(join(tempDir, 'src', 'orphan.ts'),
      `export function unusedHelper() { return 42; }\n`
    );
    // Create another file that does NOT import orphan
    writeFileSync(join(tempDir, 'src', 'main.ts'),
      `export function main() { console.log('hello'); }\n`
    );

    const originalLog = console.log;
    let output = '';
    console.log = (msg: string) => { output += msg; };

    gcCommand({ json: true });

    console.log = originalLog;
    const result = JSON.parse(output);
    const deadItems = result.items.filter((i: { category: string }) => i.category === 'dead-code');
    const orphanItem = deadItems.find((i: { file: string }) => i.file.includes('orphan'));
    expect(orphanItem).toBeDefined();
    expect(orphanItem.description).toContain('not imported');
  });

  it('does not flag files that are imported', () => {
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    // Create a file that exports
    writeFileSync(join(tempDir, 'src', 'helper.ts'),
      `export function helper() { return 42; }\n`
    );
    // Create a file that imports helper
    writeFileSync(join(tempDir, 'src', 'app.ts'),
      `import { helper } from './helper.js';\nexport function run() { return helper(); }\n`
    );

    const originalLog = console.log;
    let output = '';
    console.log = (msg: string) => { output += msg; };

    gcCommand({ json: true });

    console.log = originalLog;
    const result = JSON.parse(output);
    const deadItems = result.items.filter((i: { category: string; file: string }) =>
      i.category === 'dead-code' && i.file.includes('helper'));
    expect(deadItems.length).toBe(0);
  });

  it('detects orphaned test files', () => {
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    // Create a test file with no corresponding source
    writeFileSync(join(tempDir, 'src', 'deleted.test.ts'),
      `import { describe, it } from 'vitest';\ndescribe('deleted', () => { it('works', () => {}); });\n`
    );

    const originalLog = console.log;
    let output = '';
    console.log = (msg: string) => { output += msg; };

    gcCommand({ json: true });

    console.log = originalLog;
    const result = JSON.parse(output);
    const deadItems = result.items.filter((i: { category: string; file: string }) =>
      i.category === 'dead-code' && i.file.includes('deleted.test'));
    expect(deadItems.length).toBe(1);
    expect(deadItems[0].description).toContain('no corresponding source');
  });

  it('produces fix-descriptions markdown output', () => {
    mkdirSync(join(tempDir, 'docs'), { recursive: true });
    writeFileSync(join(tempDir, 'docs', 'README.md'), 'See `src/gone/file.ts` for details.');

    const originalLog = console.log;
    let output = '';
    console.log = (msg: string) => { output += msg; };

    gcCommand({ fixDescriptions: true });

    console.log = originalLog;
    expect(output).toContain('Fix Descriptions');
    expect(output).toContain('- [ ]');
    expect(output).toContain('Fix:');
  });
});
