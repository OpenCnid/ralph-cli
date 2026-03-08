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
});
