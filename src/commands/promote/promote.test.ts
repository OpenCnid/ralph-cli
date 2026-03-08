import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promoteDocCommand, promoteLintCommand, promotePatternCommand, promoteListCommand } from './index.js';

function makeTempDir(): string {
  const dir = join(tmpdir(), `ralph-promote-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('promote commands', () => {
  let tempDir: string;
  const origCwd = process.cwd();

  beforeEach(() => {
    tempDir = makeTempDir();
    mkdirSync(join(tempDir, '.git'), { recursive: true });
    mkdirSync(join(tempDir, '.ralph', 'rules'), { recursive: true });
    mkdirSync(join(tempDir, 'docs', 'design-docs'), { recursive: true });
    writeFileSync(join(tempDir, '.ralph', 'config.yml'), 'project:\n  name: test\n  language: typescript\n');
    writeFileSync(join(tempDir, 'docs', 'design-docs', 'core-beliefs.md'), '# Core Beliefs\n\n1. First principle\n');
    writeFileSync(join(tempDir, 'docs', 'design-docs', 'index.md'), '# Design Docs\n\n| Document | Status | Description |\n|----------|--------|-------------|\n\n## Adding\n\nCreate new docs here.\n');
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('promotes a principle to core-beliefs.md in spec format', () => {
    promoteDocCommand('Always validate at boundaries', {});

    const content = readFileSync(join(tempDir, 'docs', 'design-docs', 'core-beliefs.md'), 'utf-8');
    // Spec format: - **principle.** Added DATE.
    expect(content).toMatch(/- \*\*Always validate at boundaries\.\*\* Added \d{4}-\d{2}-\d{2}\./);
  });

  it('handles principle already ending with period', () => {
    promoteDocCommand('Never swallow errors.', {});

    const content = readFileSync(join(tempDir, 'docs', 'design-docs', 'core-beliefs.md'), 'utf-8');
    // Should not double the period
    expect(content).toMatch(/- \*\*Never swallow errors\.\*\* Added \d{4}-\d{2}-\d{2}\./);
    expect(content).not.toContain('errors..');
  });

  it('promotes to a specific doc with --to', () => {
    writeFileSync(join(tempDir, 'docs', 'SECURITY.md'), '# Security\n');
    promoteDocCommand('Never log credentials', { to: 'SECURITY.md' });

    const content = readFileSync(join(tempDir, 'docs', 'SECURITY.md'), 'utf-8');
    expect(content).toContain('Never log credentials');
  });

  it('creates a lint rule YAML file', () => {
    promoteLintCommand('no-direct-db', {
      description: 'No direct DB access outside data layer',
      pattern: 'prisma\\.client',
      fix: 'Use repository pattern instead of direct Prisma access',
    });

    const filePath = join(tempDir, '.ralph', 'rules', 'no-direct-db.yml');
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('name: no-direct-db');
    expect(content).toContain('severity: error');
    expect(content).toContain("pattern: 'prisma\\.client'");
    expect(content).toContain('fix: Use repository pattern');
  });

  it('creates a design doc for a pattern', () => {
    promotePatternCommand('Repository Pattern', { description: 'Abstract data access behind repositories' });

    const filePath = join(tempDir, 'docs', 'design-docs', 'repository-pattern.md');
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('# Repository Pattern');
    expect(content).toContain('## When to Use');
    expect(content).toContain('Abstract data access');
  });

  it('updates design-docs/index.md when creating a pattern', () => {
    promotePatternCommand('Error Boundaries', { description: 'Structured error handling' });

    const index = readFileSync(join(tempDir, 'docs', 'design-docs', 'index.md'), 'utf-8');
    expect(index).toContain('error-boundaries.md');
  });

  it('promote list shows violation counts for lint rules with violations', () => {
    // Create a lint rule that matches console.log
    writeFileSync(join(tempDir, '.ralph', 'rules', 'no-console.yml'),
      "name: no-console\ndescription: No console.log in production code\nseverity: warning\nmatch:\n  pattern: 'console\\.log'\nfix: Use a proper logging library instead\n"
    );

    // Create a source file with console.log violations
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'app.ts'), 'console.log("hello");\nconsole.log("world");\n');

    const output: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => output.push(msg);
    try {
      promoteListCommand();
    } finally {
      console.log = origLog;
    }

    const lintLine = output.find(l => l.includes('no-console'));
    expect(lintLine).toBeDefined();
    expect(lintLine).toContain('○'); // has violations
    expect(lintLine).toContain('2 violation(s) remaining');
  });

  it('promote list shows checkmark for lint rules with zero violations', () => {
    // Create a lint rule that won't match anything
    writeFileSync(join(tempDir, '.ralph', 'rules', 'no-yolo.yml'),
      "name: no-yolo\ndescription: No YOLO in code\nseverity: error\nmatch:\n  pattern: 'YOLO_ACCESS'\nfix: Use proper data access patterns\n"
    );

    // Create a source file with no violations
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'clean.ts'), 'const x = 1;\n');

    const output: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => output.push(msg);
    try {
      promoteListCommand();
    } finally {
      console.log = origLog;
    }

    const lintLine = output.find(l => l.includes('no-yolo'));
    expect(lintLine).toBeDefined();
    expect(lintLine).toContain('✓'); // no violations
    expect(lintLine).not.toContain('violation');
  });
});
