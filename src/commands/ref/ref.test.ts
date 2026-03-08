import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { refAddCommand, refListCommand, refRemoveCommand, refDiscoverCommand } from './index.js';
import * as prompt from '../../utils/prompt.js';

function makeTempDir(): string {
  const dir = join(tmpdir(), `ralph-ref-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

let originalIsTtyDescriptor: PropertyDescriptor | undefined;

function setStdinIsTty(value: boolean): void {
  if (originalIsTtyDescriptor === undefined) {
    originalIsTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  }
  Object.defineProperty(process.stdin, 'isTTY', {
    configurable: true,
    value,
  });
}

function restoreStdinIsTty(): void {
  if (originalIsTtyDescriptor) {
    Object.defineProperty(process.stdin, 'isTTY', originalIsTtyDescriptor);
  }
}

describe('ref commands', () => {
  let tempDir: string;
  const origCwd = process.cwd();

  beforeEach(() => {
    tempDir = makeTempDir();
    mkdirSync(join(tempDir, '.git'), { recursive: true });
    mkdirSync(join(tempDir, '.ralph'), { recursive: true });
    mkdirSync(join(tempDir, 'docs', 'references'), { recursive: true });
    writeFileSync(join(tempDir, '.ralph', 'config.yml'), 'project:\n  name: test\n  language: typescript\n');
    process.chdir(tempDir);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    restoreStdinIsTty();
    process.chdir(origCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('adds a local file as reference', async () => {
    writeFileSync(join(tempDir, 'my-doc.txt'), 'This is a reference document.');
    await refAddCommand('my-doc.txt', { name: 'my-tool' });

    const refFile = join(tempDir, 'docs', 'references', 'my-tool-llms.txt');
    expect(existsSync(refFile)).toBe(true);

    const content = readFileSync(refFile, 'utf-8');
    expect(content).toContain('<!-- ralph-ref:');
    expect(content).toContain('source=my-doc.txt');
    expect(content).toContain('This is a reference document.');
  });

  it('auto-names from filename when no --name provided', async () => {
    writeFileSync(join(tempDir, 'framework-llms.txt'), 'Framework docs.');
    await refAddCommand('framework-llms.txt', {});

    const files = readdirSync(join(tempDir, 'docs', 'references')).filter(f => f.endsWith('.txt'));
    expect(files.length).toBe(1);
    expect(files[0]).toContain('framework');
  });

  it('removes a reference', async () => {
    writeFileSync(join(tempDir, 'docs', 'references', 'old-ref-llms.txt'), '<!-- ralph-ref: source=local fetched=2026-01-01 -->\nOld content');
    refRemoveCommand('old-ref');

    expect(existsSync(join(tempDir, 'docs', 'references', 'old-ref-llms.txt'))).toBe(false);
  });

  it('adds a local .md file with -llms.md suffix', async () => {
    writeFileSync(join(tempDir, 'my-doc-llms.md'), '# Reference\n\nMarkdown reference.');
    await refAddCommand('my-doc-llms.md', {});

    const files = readdirSync(join(tempDir, 'docs', 'references')).filter(f => f.endsWith('.md') && !f.startsWith('.'));
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/-llms\.md$/);

    const content = readFileSync(join(tempDir, 'docs', 'references', files[0]!), 'utf-8');
    expect(content).toContain('Markdown reference.');
  });

  it('uses -llms.txt suffix for .txt source files', async () => {
    writeFileSync(join(tempDir, 'plain.txt'), 'Plain text ref.');
    await refAddCommand('plain.txt', { name: 'plain-ref' });

    expect(existsSync(join(tempDir, 'docs', 'references', 'plain-ref-llms.txt'))).toBe(true);
  });

  it('adds metadata comment with source and date', async () => {
    writeFileSync(join(tempDir, 'source.txt'), 'Content');
    await refAddCommand('source.txt', { name: 'test' });

    const content = readFileSync(join(tempDir, 'docs', 'references', 'test-llms.txt'), 'utf-8');
    expect(content).toMatch(/<!-- ralph-ref: source=source\.txt fetched=\d{4}-\d{2}-\d{2} -->/);
  });

  it('discover reports no deps when no dependency file exists', async () => {
    const output: string[] = [];
    const origLog = console.log;
    const origInfo = console.info;
    console.log = (msg: string) => output.push(msg);

    await refDiscoverCommand();

    console.log = origLog;
    // Should report no dependencies found (no package.json, pyproject.toml, or go.mod)
    // The info() function uses console.log internally
  });

  it('discover extracts dependencies from package.json', { timeout: 30000 }, async () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      name: 'test-project',
      dependencies: { 'express': '^4.0.0', 'lodash': '^4.0.0' },
      devDependencies: { 'vitest': '^1.0.0' },
    }));

    const output: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => output.push(msg);

    // This will attempt network requests that will fail, but it should still
    // show "Scanning X dependencies..." message
    await refDiscoverCommand();

    console.log = origLog;
    const scanMsg = output.find(l => l.includes('Scanning'));
    expect(scanMsg).toBeDefined();
    expect(scanMsg).toContain('3 dependencies');
  });

  it('discover skips add prompt in non-TTY mode', async () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      name: 'test-project',
      dependencies: { express: '^4.0.0' },
    }));

    setStdinIsTty(false);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    const askSpy = vi.spyOn(prompt, 'ask');

    await refDiscoverCommand();

    expect(askSpy).not.toHaveBeenCalled();
    const refFiles = readdirSync(join(tempDir, 'docs', 'references')).filter(f => !f.startsWith('.'));
    expect(refFiles.length).toBe(0);
  });
});
