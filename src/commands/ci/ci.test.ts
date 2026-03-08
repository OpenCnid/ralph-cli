import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ciGenerateCommand } from './index.js';

function makeTempDir(): string {
  const dir = join(tmpdir(), `ralph-ci-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('ci generate', () => {
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

  it('generates GitHub Actions workflow', () => {
    ciGenerateCommand({ platform: 'github' });

    const workflowPath = join(tempDir, '.github', 'workflows', 'ralph.yml');
    expect(existsSync(workflowPath)).toBe(true);

    const content = readFileSync(workflowPath, 'utf-8');
    expect(content).toContain('ralph lint');
    expect(content).toContain('ralph grade --ci');
    expect(content).toContain('ralph doctor --ci');
    expect(content).toContain('actions/checkout');
  });

  it('generates GitLab CI config', () => {
    ciGenerateCommand({ platform: 'gitlab' });

    const ciPath = join(tempDir, '.ralph-ci.gitlab-ci.yml');
    expect(existsSync(ciPath)).toBe(true);

    const content = readFileSync(ciPath, 'utf-8');
    expect(content).toContain('ralph lint');
    expect(content).toContain('stages:');
  });

  it('outputs generic commands for unknown platform', () => {
    const originalLog = console.log;
    let output = '';
    console.log = (msg: string) => { output += msg; };

    ciGenerateCommand({ platform: 'generic' });

    console.log = originalLog;
    expect(output).toContain('ralph lint');
    expect(output).toContain('ralph grade --ci');
  });

  it('includes cache step for ralph-cli in GitHub Actions', () => {
    ciGenerateCommand({ platform: 'github' });

    const content = readFileSync(join(tempDir, '.github', 'workflows', 'ralph.yml'), 'utf-8');
    expect(content).toContain('actions/cache@v4');
    expect(content).toContain('Cache ralph-cli');
  });

  it('includes cache config in GitLab CI', () => {
    ciGenerateCommand({ platform: 'gitlab' });

    const content = readFileSync(join(tempDir, '.ralph-ci.gitlab-ci.yml'), 'utf-8');
    expect(content).toContain('cache:');
    expect(content).toContain('key: ralph-cli');
  });

  it('auto-detects GitHub when .github/ exists', () => {
    mkdirSync(join(tempDir, '.github'), { recursive: true });
    ciGenerateCommand({});

    expect(existsSync(join(tempDir, '.github', 'workflows', 'ralph.yml'))).toBe(true);
  });
});
