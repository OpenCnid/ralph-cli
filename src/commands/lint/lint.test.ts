import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runRules, formatViolation, formatJson } from './engine.js';
import type { LintRule, LintContext, LintViolation } from './engine.js';
import { createFileSizeRule } from './rules/file-size.js';
import { createNamingConventionRule } from './rules/naming-convention.js';
import { loadCustomRules } from './rules/custom-rules.js';
import { collectFiles } from './files.js';
import { parseImports } from './imports.js';
import { createDomainIsolationRule } from './rules/domain-isolation.js';
import { createFileOrganizationRule } from './rules/file-organization.js';

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

describe('domain-isolation rule', () => {
  let tempDir: string;

  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it('flags cross-domain imports', () => {
    // Create domain structure
    mkdirSync(join(tempDir, 'src', 'domain', 'auth'), { recursive: true });
    mkdirSync(join(tempDir, 'src', 'domain', 'billing'), { recursive: true });

    // Auth file imports from billing (../billing relative to src/domain/auth/)
    writeFileSync(join(tempDir, 'src', 'domain', 'auth', 'service.ts'),
      `import { PaymentService } from '../billing/payment.js';\n`
    );
    writeFileSync(join(tempDir, 'src', 'domain', 'billing', 'payment.ts'),
      `export class PaymentService {}\n`
    );

    const rule = createDomainIsolationRule(
      [
        { name: 'auth', path: 'src/domain/auth' },
        { name: 'billing', path: 'src/domain/billing' },
      ],
      [],
    );

    const violations = rule.run({
      projectRoot: tempDir,
      files: [join(tempDir, 'src', 'domain', 'auth', 'service.ts')],
    });

    expect(violations.length).toBe(1);
    expect(violations[0]!.severity).toBe('error');
    expect(violations[0]!.what).toContain('auth');
    expect(violations[0]!.what).toContain('billing');
  });

  it('allows same-domain imports', () => {
    mkdirSync(join(tempDir, 'src', 'domain', 'auth'), { recursive: true });

    writeFileSync(join(tempDir, 'src', 'domain', 'auth', 'service.ts'),
      `import { User } from './types.js';\n`
    );
    writeFileSync(join(tempDir, 'src', 'domain', 'auth', 'types.ts'),
      `export interface User {}\n`
    );

    const rule = createDomainIsolationRule(
      [{ name: 'auth', path: 'src/domain/auth' }],
      [],
    );

    const violations = rule.run({
      projectRoot: tempDir,
      files: [join(tempDir, 'src', 'domain', 'auth', 'service.ts')],
    });

    expect(violations.length).toBe(0);
  });

  it('allows imports from cross-cutting concerns', () => {
    mkdirSync(join(tempDir, 'src', 'domain', 'auth'), { recursive: true });
    mkdirSync(join(tempDir, 'src', 'shared'), { recursive: true });

    writeFileSync(join(tempDir, 'src', 'domain', 'auth', 'service.ts'),
      `import { logger } from '../../../shared/logger.js';\n`
    );
    writeFileSync(join(tempDir, 'src', 'shared', 'logger.ts'),
      `export const logger = {};\n`
    );

    const rule = createDomainIsolationRule(
      [{ name: 'auth', path: 'src/domain/auth' }],
      ['src/shared'],
    );

    // The resolved import should resolve to src/shared/logger.js which is cross-cutting
    const violations = rule.run({
      projectRoot: tempDir,
      files: [join(tempDir, 'src', 'domain', 'auth', 'service.ts')],
    });

    expect(violations.length).toBe(0);
  });

  it('returns no violations when no domains configured', () => {
    const rule = createDomainIsolationRule(undefined, undefined);
    const violations = rule.run({ projectRoot: tempDir, files: [] });
    expect(violations.length).toBe(0);
  });

  it('returns no violations for files outside domains', () => {
    mkdirSync(join(tempDir, 'src', 'utils'), { recursive: true });
    mkdirSync(join(tempDir, 'src', 'domain', 'auth'), { recursive: true });

    writeFileSync(join(tempDir, 'src', 'utils', 'helper.ts'),
      `import { User } from '../domain/auth/types.js';\n`
    );

    const rule = createDomainIsolationRule(
      [{ name: 'auth', path: 'src/domain/auth' }],
      [],
    );

    const violations = rule.run({
      projectRoot: tempDir,
      files: [join(tempDir, 'src', 'utils', 'helper.ts')],
    });

    expect(violations.length).toBe(0);
  });

  it('includes agent-readable fix instructions', () => {
    mkdirSync(join(tempDir, 'src', 'domain', 'auth'), { recursive: true });
    mkdirSync(join(tempDir, 'src', 'domain', 'billing'), { recursive: true });

    writeFileSync(join(tempDir, 'src', 'domain', 'auth', 'service.ts'),
      `import { Invoice } from '../billing/invoice.js';\n`
    );

    const rule = createDomainIsolationRule(
      [
        { name: 'auth', path: 'src/domain/auth' },
        { name: 'billing', path: 'src/domain/billing' },
      ],
      ['src/shared'],
    );

    const violations = rule.run({
      projectRoot: tempDir,
      files: [join(tempDir, 'src', 'domain', 'auth', 'service.ts')],
    });

    expect(violations.length).toBe(1);
    expect(violations[0]!.fix).toContain('cross-cutting');
    expect(violations[0]!.fix).toContain('src/shared');
    expect(violations[0]!.rule).toContain('isolated');
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

describe('file-organization rule', () => {
  let tempDir: string;

  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it('flags files in utils/ with business logic names', () => {
    mkdirSync(join(tempDir, 'src', 'utils'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'utils', 'handlePayment.ts'),
      `export function handlePayment() { return true; }\n`
    );

    const rule = createFileOrganizationRule([]);
    const violations = rule.run({
      projectRoot: tempDir,
      files: [join(tempDir, 'src', 'utils', 'handlePayment.ts')],
    });

    expect(violations.length).toBe(1);
    expect(violations[0]!.severity).toBe('error');
    expect(violations[0]!.what).toContain('business logic');
    expect(violations[0]!.what).toContain('handlePayment.ts');
  });

  it('allows generic utility files in utils/', () => {
    mkdirSync(join(tempDir, 'src', 'utils'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'utils', 'format.ts'),
      `export function formatDate(d: Date): string { return d.toISOString(); }\n`
    );

    const rule = createFileOrganizationRule([]);
    const violations = rule.run({
      projectRoot: tempDir,
      files: [join(tempDir, 'src', 'utils', 'format.ts')],
    });

    expect(violations.length).toBe(0);
  });

  it('flags utils/ files that import from domain paths', () => {
    mkdirSync(join(tempDir, 'src', 'utils'), { recursive: true });
    mkdirSync(join(tempDir, 'src', 'domain', 'billing'), { recursive: true });

    writeFileSync(join(tempDir, 'src', 'utils', 'pricing.ts'),
      `import { Product } from '../domain/billing/product.js';\nexport function getPrice(p: any) { return p.price; }\n`
    );
    writeFileSync(join(tempDir, 'src', 'domain', 'billing', 'product.ts'),
      `export interface Product { price: number; }\n`
    );

    const rule = createFileOrganizationRule([
      { name: 'billing', path: 'src/domain/billing' },
    ]);
    const violations = rule.run({
      projectRoot: tempDir,
      files: [join(tempDir, 'src', 'utils', 'pricing.ts')],
    });

    expect(violations.length).toBe(1);
    expect(violations[0]!.what).toContain('billing');
    expect(violations[0]!.fix).toContain('src/domain/billing');
  });

  it('flags utils/ files with class declarations', () => {
    mkdirSync(join(tempDir, 'src', 'utils'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'utils', 'service.ts'),
      `export class PaymentProcessor {\n  process() {}\n}\n`
    );

    const rule = createFileOrganizationRule([]);
    const violations = rule.run({
      projectRoot: tempDir,
      files: [join(tempDir, 'src', 'utils', 'service.ts')],
    });

    expect(violations.length).toBe(1);
    expect(violations[0]!.what).toContain('class declarations');
  });

  it('ignores files outside utils/', () => {
    mkdirSync(join(tempDir, 'src', 'domain'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'domain', 'handlePayment.ts'),
      `export function handlePayment() { return true; }\n`
    );

    const rule = createFileOrganizationRule([]);
    const violations = rule.run({
      projectRoot: tempDir,
      files: [join(tempDir, 'src', 'domain', 'handlePayment.ts')],
    });

    expect(violations.length).toBe(0);
  });

  it('works with no domains configured', () => {
    mkdirSync(join(tempDir, 'src', 'utils'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'utils', 'processOrder.ts'),
      `export function processOrder() {}\n`
    );

    const rule = createFileOrganizationRule(undefined);
    const violations = rule.run({
      projectRoot: tempDir,
      files: [join(tempDir, 'src', 'utils', 'processOrder.ts')],
    });

    expect(violations.length).toBe(1);
    expect(violations[0]!.fix).toContain('domain module');
  });

  it('detects helpers/ directory as utils-like', () => {
    mkdirSync(join(tempDir, 'src', 'helpers'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'helpers', 'manageUsers.ts'),
      `export function manageUsers() {}\n`
    );

    const rule = createFileOrganizationRule([]);
    const violations = rule.run({
      projectRoot: tempDir,
      files: [join(tempDir, 'src', 'helpers', 'manageUsers.ts')],
    });

    expect(violations.length).toBe(1);
  });
});

describe('naming-convention autofix', () => {
  let tempDir: string;

  beforeEach(() => { tempDir = makeTempDir(); });
  afterEach(() => { rmSync(tempDir, { recursive: true, force: true }); });

  it('renames non-conforming Zod schema exports in-place', () => {
    const file = join(tempDir, 'user.ts');
    writeFileSync(file, `import { z } from 'zod';
export const UserData = z.object({ name: z.string() });
export type User = z.infer<typeof UserData>;
`);

    const rule = createNamingConventionRule({ schemas: '*Schema', types: '*Type' });
    const fixes = rule.autofix!({ projectRoot: tempDir, files: [file] });

    expect(fixes.length).toBeGreaterThanOrEqual(1);
    expect(fixes[0]!.description).toContain('UserData');
    expect(fixes[0]!.description).toContain('UserDataSchema');

    // Verify file was actually renamed
    const content = readFileSync(file, 'utf-8');
    expect(content).toContain('export const UserDataSchema = z.object');
    expect(content).toContain('typeof UserDataSchema');
    expect(content).not.toContain('UserData =');
  });

  it('updates references in importing files', () => {
    const schemaFile = join(tempDir, 'schema.ts');
    const consumerFile = join(tempDir, 'consumer.ts');

    writeFileSync(schemaFile, `import { z } from 'zod';
export const UserData = z.object({ name: z.string() });
`);
    writeFileSync(consumerFile, `import { UserData } from './schema.js';
const parsed = UserData.parse({ name: 'test' });
`);

    const rule = createNamingConventionRule({ schemas: '*Schema', types: '*Type' });
    const fixes = rule.autofix!({
      projectRoot: tempDir,
      files: [schemaFile, consumerFile],
    });

    expect(fixes.length).toBe(2); // declaring file + importing file

    const schemaContent = readFileSync(schemaFile, 'utf-8');
    expect(schemaContent).toContain('UserDataSchema');

    const consumerContent = readFileSync(consumerFile, 'utf-8');
    expect(consumerContent).toContain('import { UserDataSchema }');
    expect(consumerContent).toContain('UserDataSchema.parse');
  });

  it('returns empty array when no violations exist', () => {
    const file = join(tempDir, 'user.ts');
    writeFileSync(file, `import { z } from 'zod';
export const UserSchema = z.object({ name: z.string() });
`);

    const rule = createNamingConventionRule({ schemas: '*Schema', types: '*Type' });
    const fixes = rule.autofix!({ projectRoot: tempDir, files: [file] });
    expect(fixes.length).toBe(0);
  });

  it('produces no violations after autofix is applied', () => {
    const file = join(tempDir, 'order.ts');
    writeFileSync(file, `import { z } from 'zod';
export const OrderInfo = z.object({ id: z.number() });
`);

    const rule = createNamingConventionRule({ schemas: '*Schema', types: '*Type' });

    // Verify violation exists before fix
    const beforeViolations = rule.run({ projectRoot: tempDir, files: [file] });
    expect(beforeViolations.length).toBe(1);

    // Apply fix
    rule.autofix!({ projectRoot: tempDir, files: [file] });

    // Verify no violations after fix
    const afterViolations = rule.run({ projectRoot: tempDir, files: [file] });
    expect(afterViolations.length).toBe(0);
  });

  it('fix suggestion uses computed name from pattern', () => {
    const file = join(tempDir, 'item.ts');
    writeFileSync(file, `import { z } from 'zod';
export const ItemData = z.object({ name: z.string() });
`);

    const rule = createNamingConventionRule({ schemas: '*Schema', types: '*Type' });
    const violations = rule.run({ projectRoot: tempDir, files: [file] });
    expect(violations.length).toBe(1);
    expect(violations[0]!.fix).toContain('ItemDataSchema');
  });
});

describe('formatJson with fixes', () => {
  it('includes fixes in JSON output when provided', () => {
    const result = {
      violations: [],
      rulesRun: ['naming-convention'],
    };
    const fixes = [{ file: 'user.ts', description: 'Renamed UserData to UserDataSchema' }];
    const json = JSON.parse(formatJson(result, fixes));
    expect(json.fixes).toHaveLength(1);
    expect(json.fixes[0].file).toBe('user.ts');
  });

  it('omits fixes from JSON when none applied', () => {
    const result = {
      violations: [],
      rulesRun: ['naming-convention'],
    };
    const json = JSON.parse(formatJson(result));
    expect(json.fixes).toBeUndefined();
  });
});
