import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runRules, formatViolation, formatJson } from './engine.js';
import type { LintRule, LintContext, LintViolation } from './engine.js';
import { createFileSizeRule } from './rules/file-size.js';
import { createNamingConventionRule } from './rules/naming-convention.js';
import { loadCustomRules } from './rules/custom-rules.js';
import { collectFiles } from './files.js';
import { parseImports } from './imports.js';

function makeTempDir(): string {
  const dir = join(tmpdir(), `ralph-lint-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('engine', () => {
  it('runs rules and collects violations', () => {
    const rule: LintRule = {
      name: 'test-rule',
      description: 'test',
      run: () => [{
        file: 'test.ts',
        what: 'test violation',
        rule: 'test rule',
        fix: 'fix it',
        severity: 'error',
      }],
    };

    const result = runRules([rule], { projectRoot: '/tmp', files: [] });
    expect(result.rulesRun).toEqual(['test-rule']);
    expect(result.violations.length).toBe(1);
    expect(result.violations[0]!.what).toBe('test violation');
  });

  it('formats violations with what/rule/fix', () => {
    const v: LintViolation = {
      file: 'src/test.ts',
      line: 10,
      what: 'bad import',
      rule: 'no-bad-imports',
      fix: 'remove the import',
      severity: 'error',
    };
    const formatted = formatViolation(v);
    expect(formatted).toContain('ERROR');
    expect(formatted).toContain('src/test.ts:10');
    expect(formatted).toContain('What: bad import');
    expect(formatted).toContain('Rule: no-bad-imports');
    expect(formatted).toContain('Fix: remove the import');
  });

  it('formats warnings correctly', () => {
    const v: LintViolation = {
      file: 'src/big.ts',
      what: 'too big',
      rule: 'file-size',
      fix: 'split it',
      severity: 'warning',
    };
    expect(formatViolation(v)).toContain('WARNING');
  });

  it('produces valid JSON output', () => {
    const result = {
      violations: [{
        file: 'test.ts',
        what: 'violation',
        rule: 'rule',
        fix: 'fix',
        severity: 'error' as const,
      }],
      rulesRun: ['rule'],
    };
    const json = JSON.parse(formatJson(result));
    expect(json.violations.length).toBe(1);
    expect(json.summary.total).toBe(1);
    expect(json.summary.errors).toBe(1);
  });
});

describe('file-size rule', () => {
  let tempDir: string;

  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it('flags files exceeding max lines', () => {
    const bigFile = join(tempDir, 'big.ts');
    writeFileSync(bigFile, Array(600).fill('// line').join('\n'));

    const rule = createFileSizeRule(500);
    const violations = rule.run({ projectRoot: tempDir, files: [bigFile] });
    expect(violations.length).toBe(1);
    expect(violations[0]!.severity).toBe('warning');
    expect(violations[0]!.what).toContain('600');
  });

  it('passes files within limit', () => {
    const smallFile = join(tempDir, 'small.ts');
    writeFileSync(smallFile, Array(100).fill('// line').join('\n'));

    const rule = createFileSizeRule(500);
    const violations = rule.run({ projectRoot: tempDir, files: [smallFile] });
    expect(violations.length).toBe(0);
  });
});

describe('naming-convention rule', () => {
  let tempDir: string;

  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it('flags Zod schemas that do not match naming pattern', () => {
    const file = join(tempDir, 'user.ts');
    writeFileSync(file, `
import { z } from 'zod';
export const UserData = z.object({ name: z.string() });
`);

    const rule = createNamingConventionRule({ schemas: '*Schema', types: '*Type' });
    const violations = rule.run({ projectRoot: tempDir, files: [file] });
    expect(violations.length).toBe(1);
    expect(violations[0]!.what).toContain('UserData');
    expect(violations[0]!.fix).toContain('UserDataSchema');
  });

  it('passes correctly named schemas', () => {
    const file = join(tempDir, 'user.ts');
    writeFileSync(file, `
import { z } from 'zod';
export const UserSchema = z.object({ name: z.string() });
`);

    const rule = createNamingConventionRule({ schemas: '*Schema', types: '*Type' });
    const violations = rule.run({ projectRoot: tempDir, files: [file] });
    expect(violations.length).toBe(0);
  });
});

describe('custom rules', () => {
  let tempDir: string;

  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it('loads and runs custom YAML rules', () => {
    const rulesDir = join(tempDir, 'rules');
    mkdirSync(rulesDir, { recursive: true });

    writeFileSync(join(rulesDir, 'no-console.yml'), `
name: no-console
description: Console.log should not be in production code
severity: warning
match:
  pattern: 'console\\.log'
fix: Use a proper logger instead of console.log
`);

    const sourceFile = join(tempDir, 'app.ts');
    writeFileSync(sourceFile, `
const x = 1;
console.log(x);
`);

    const rules = loadCustomRules(rulesDir);
    expect(rules.length).toBe(1);
    expect(rules[0]!.name).toBe('no-console');

    const violations = rules[0]!.run({ projectRoot: tempDir, files: [sourceFile] });
    expect(violations.length).toBe(1);
    expect(violations[0]!.severity).toBe('warning');
  });

  it('supports require-nearby pattern', () => {
    const rulesDir = join(tempDir, 'rules');
    mkdirSync(rulesDir, { recursive: true });

    writeFileSync(join(rulesDir, 'error-handling.yml'), `
name: error-handling
description: Async functions must have error handling
severity: error
match:
  pattern: 'await\\s+'
  require-nearby: 'catch|try'
  within-lines: 5
fix: Wrap await calls in try/catch blocks
`);

    // File without error handling
    const badFile = join(tempDir, 'bad.ts');
    writeFileSync(badFile, `
async function fetchData() {
  const result = await fetch('/api');
  return result.json();
}
`);

    const rules = loadCustomRules(rulesDir);
    const violations = rules[0]!.run({ projectRoot: tempDir, files: [badFile] });
    expect(violations.length).toBe(1);

    // File with error handling
    const goodFile = join(tempDir, 'good.ts');
    writeFileSync(goodFile, `
async function fetchData() {
  try {
    const result = await fetch('/api');
    return result.json();
  } catch (e) {
    throw e;
  }
}
`);

    const noViolations = rules[0]!.run({ projectRoot: tempDir, files: [goodFile] });
    expect(noViolations.length).toBe(0);
  });

  it('returns empty array for non-existent rules directory', () => {
    const rules = loadCustomRules(join(tempDir, 'nonexistent'));
    expect(rules).toEqual([]);
  });
});

describe('parseImports', () => {
  let tempDir: string;

  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it('parses ES module imports', () => {
    const file = join(tempDir, 'test.ts');
    writeFileSync(file, `
import { foo } from './foo.js';
import type { Bar } from '../bar.js';
import * as baz from 'baz';
`);

    const imports = parseImports(file);
    expect(imports.length).toBe(3);
    expect(imports[0]!.source).toBe('./foo.js');
    expect(imports[0]!.line).toBe(2);
    expect(imports[1]!.source).toBe('../bar.js');
    expect(imports[2]!.source).toBe('baz');
  });

  it('parses dynamic imports', () => {
    const file = join(tempDir, 'test.ts');
    writeFileSync(file, `const mod = await import('./dynamic.js');\n`);

    const imports = parseImports(file);
    expect(imports.length).toBe(1);
    expect(imports[0]!.source).toBe('./dynamic.js');
  });

  it('parses CommonJS require', () => {
    const file = join(tempDir, 'test.js');
    writeFileSync(file, `const fs = require('node:fs');\n`);

    const imports = parseImports(file);
    expect(imports.length).toBe(1);
    expect(imports[0]!.source).toBe('node:fs');
  });

  it('parses Python imports', () => {
    const file = join(tempDir, 'test.py');
    writeFileSync(file, `
from django.db import models
import os
`);

    const imports = parseImports(file);
    expect(imports.length).toBe(2);
    expect(imports[0]!.source).toBe('django.db');
    expect(imports[1]!.source).toBe('os');
  });

  it('returns empty array for nonexistent file', () => {
    expect(parseImports(join(tempDir, 'nope.ts'))).toEqual([]);
  });
});

describe('collectFiles', () => {
  let tempDir: string;

  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it('collects source files recursively', () => {
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'app.ts'), '');
    writeFileSync(join(tempDir, 'src', 'utils.js'), '');
    writeFileSync(join(tempDir, 'README.md'), '');

    const files = collectFiles(tempDir);
    expect(files.length).toBe(2);
  });

  it('excludes node_modules and dist', () => {
    mkdirSync(join(tempDir, 'node_modules', 'pkg'), { recursive: true });
    mkdirSync(join(tempDir, 'dist'), { recursive: true });
    writeFileSync(join(tempDir, 'node_modules', 'pkg', 'index.js'), '');
    writeFileSync(join(tempDir, 'dist', 'cli.js'), '');
    writeFileSync(join(tempDir, 'src.ts'), '');

    const files = collectFiles(tempDir);
    expect(files.length).toBe(1);
    expect(files[0]).toContain('src.ts');
  });

  it('excludes test files', () => {
    writeFileSync(join(tempDir, 'app.ts'), '');
    writeFileSync(join(tempDir, 'app.test.ts'), '');
    writeFileSync(join(tempDir, 'app.spec.ts'), '');

    const files = collectFiles(tempDir);
    expect(files.length).toBe(1);
    expect(files[0]).toContain('app.ts');
  });
});
