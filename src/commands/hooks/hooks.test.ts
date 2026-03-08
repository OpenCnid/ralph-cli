import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hooksInstallCommand, hooksUninstallCommand } from './index.js';

function makeTempDir(): string {
  const dir = join(tmpdir(), `ralph-hooks-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('hooks commands', () => {
  let tempDir: string;
  const origCwd = process.cwd();

  beforeEach(() => {
    tempDir = makeTempDir();
    mkdirSync(join(tempDir, '.git', 'hooks'), { recursive: true });
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('installs default pre-commit hook', () => {
    hooksInstallCommand({});

    const hookPath = join(tempDir, '.git', 'hooks', 'pre-commit');
    expect(existsSync(hookPath)).toBe(true);

    const content = readFileSync(hookPath, 'utf-8');
    expect(content).toContain('ralph-cli');
    expect(content).toContain('ralph lint');
  });

  it('installs all hooks with --all', () => {
    hooksInstallCommand({ all: true });

    expect(existsSync(join(tempDir, '.git', 'hooks', 'pre-commit'))).toBe(true);
    expect(existsSync(join(tempDir, '.git', 'hooks', 'post-commit'))).toBe(true);
    expect(existsSync(join(tempDir, '.git', 'hooks', 'pre-push'))).toBe(true);
  });

  it('creates hooks in .ralph/hooks/', () => {
    hooksInstallCommand({});

    expect(existsSync(join(tempDir, '.ralph', 'hooks', 'pre-commit'))).toBe(true);
  });

  it('uninstalls ralph hooks', () => {
    hooksInstallCommand({ all: true });
    hooksUninstallCommand();

    expect(existsSync(join(tempDir, '.git', 'hooks', 'pre-commit'))).toBe(false);
    expect(existsSync(join(tempDir, '.git', 'hooks', 'post-commit'))).toBe(false);
    expect(existsSync(join(tempDir, '.git', 'hooks', 'pre-push'))).toBe(false);
  });

  it('hook scripts fail gracefully when ralph not installed', () => {
    hooksInstallCommand({});

    const content = readFileSync(join(tempDir, '.git', 'hooks', 'pre-commit'), 'utf-8');
    expect(content).toContain('command -v ralph');
    expect(content).toContain('exit 0'); // graceful exit if not found
  });

  it('pre-commit hook only lints staged source files', () => {
    hooksInstallCommand({});

    const content = readFileSync(join(tempDir, '.git', 'hooks', 'pre-commit'), 'utf-8');
    expect(content).toContain('git diff --cached --name-only');
    expect(content).toContain('--diff-filter=ACM');
    expect(content).toContain('\\.(ts|tsx|js|jsx|py|go|rs)');
    // Should skip lint if no staged source files
    expect(content).toContain('if [ -z "$STAGED" ]');
  });
});
