import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectProject } from './detect.js';

function makeTempDir(): string {
  const dir = join(tmpdir(), `ralph-detect-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('detectProject', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('detects TypeScript project from package.json', () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      name: 'my-ts-app',
      description: 'A TS app',
      devDependencies: { typescript: '^5.0.0', vitest: '^1.0.0', eslint: '^8.0.0' },
    }));

    const result = detectProject(tempDir);
    expect(result.language).toBe('typescript');
    expect(result.projectName).toBe('my-ts-app');
    expect(result.description).toBe('A TS app');
    expect(result.testRunner).toBe('vitest');
    expect(result.linter).toBe('eslint');
  });

  it('detects JavaScript project without TypeScript dep', () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      name: 'js-app',
      dependencies: { express: '^4.0.0' },
      devDependencies: { jest: '^29.0.0' },
    }));

    const result = detectProject(tempDir);
    expect(result.language).toBe('javascript');
    expect(result.framework).toBe('express');
    expect(result.testRunner).toBe('jest');
  });

  it('detects Next.js framework', () => {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      name: 'next-app',
      dependencies: { next: '^14.0.0', react: '^18.0.0' },
      devDependencies: { typescript: '^5.0.0' },
    }));

    const result = detectProject(tempDir);
    expect(result.framework).toBe('nextjs');
  });

  it('detects Python project from pyproject.toml', () => {
    writeFileSync(join(tempDir, 'pyproject.toml'), `
[project]
name = "my-py-app"
dependencies = ["fastapi"]

[tool.pytest]
testpaths = ["tests"]
`);

    const result = detectProject(tempDir);
    expect(result.language).toBe('python');
    expect(result.framework).toBe('fastapi');
    expect(result.testRunner).toBe('pytest');
    expect(result.projectName).toBe('my-py-app');
  });

  it('detects Go project from go.mod', () => {
    writeFileSync(join(tempDir, 'go.mod'), `
module github.com/user/my-go-app

go 1.21

require github.com/gin-gonic/gin v1.9.0
`);

    const result = detectProject(tempDir);
    expect(result.language).toBe('go');
    expect(result.framework).toBe('gin');
    expect(result.testRunner).toBe('go-test');
    expect(result.projectName).toBe('my-go-app');
  });

  it('detects Rust project from Cargo.toml', () => {
    writeFileSync(join(tempDir, 'Cargo.toml'), `
[package]
name = "my-rust-app"
version = "0.1.0"
`);

    const result = detectProject(tempDir);
    expect(result.language).toBe('rust');
    expect(result.projectName).toBe('my-rust-app');
  });

  it('returns defaults for empty directory', () => {
    const result = detectProject(tempDir);
    expect(result.language).toBe('typescript');
    expect(result.framework).toBeUndefined();
    expect(result.testRunner).toBeUndefined();
  });
});
