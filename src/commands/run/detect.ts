import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RalphConfig } from '../../config/schema.js';

function fileExists(dir: string, name: string): boolean {
  return existsSync(join(dir, name));
}

function readFile(dir: string, name: string): string | null {
  try {
    return readFileSync(join(dir, name), 'utf-8');
  } catch {
    return null;
  }
}

function hasMakefileTestTarget(dir: string): boolean {
  const content = readFile(dir, 'Makefile');
  if (!content) return false;
  return /^test\s*:/m.test(content);
}

function hasPyprojectMypy(dir: string): boolean {
  const content = readFile(dir, 'pyproject.toml');
  if (!content) return false;
  return /\[tool\.mypy\]/.test(content);
}

/**
 * Detect the test command for the project.
 * Config override takes precedence, then file-based detection.
 */
export function detectTestCommand(config: RalphConfig, cwd: string = process.cwd()): string | null {
  const override = config.run?.validation?.['test-command'];
  if (override != null) return override;

  const pkgContent = readFile(cwd, 'package.json');
  if (pkgContent) {
    try {
      const pkg = JSON.parse(pkgContent) as { scripts?: { test?: string } };
      if (pkg.scripts?.test) return 'npm test';
    } catch {
      // ignore
    }
  }

  if (hasMakefileTestTarget(cwd)) return 'make test';
  if (fileExists(cwd, 'pyproject.toml')) return 'pytest';
  if (fileExists(cwd, 'go.mod')) return 'go test ./...';
  if (fileExists(cwd, 'Cargo.toml')) return 'cargo test';

  return null;
}

/**
 * Detect the typecheck command for the project.
 * Config override takes precedence, then file-based detection.
 */
export function detectTypecheckCommand(config: RalphConfig, cwd: string = process.cwd()): string | null {
  const override = config.run?.validation?.['typecheck-command'];
  if (override != null) return override;

  if (fileExists(cwd, 'tsconfig.json')) return 'npx tsc --noEmit';
  if (fileExists(cwd, 'mypy.ini') || hasPyprojectMypy(cwd)) return 'mypy .';
  if (fileExists(cwd, 'go.mod')) return 'go vet ./...';

  return null;
}

/**
 * Detect the source path for the project.
 * Uses config architecture domains if present, otherwise conventional directories.
 */
export function detectSourcePath(config: RalphConfig, cwd: string = process.cwd()): string {
  const domains = config.architecture.domains;
  if (domains && domains.length > 0) {
    return domains.map((d) => d.path).join(' ');
  }

  for (const dir of ['src', 'app', 'lib']) {
    if (existsSync(join(cwd, dir))) return dir;
  }

  return '.';
}

/**
 * Normalize plan content for comparison: trim trailing whitespace per line, normalize CRLF to LF.
 */
export function normalizePlanContent(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(/[^\S\n]+$/gm, '');
}

/**
 * Detect the first newly-completed task by diffing planBefore against the current IMPLEMENTATION_PLAN.md.
 * Returns the task description, or null if no newly-completed task is found.
 */
export function detectCompletedTask(planBefore: string): string | null {
  let planAfter: string;
  try {
    planAfter = readFileSync('IMPLEMENTATION_PLAN.md', 'utf-8');
  } catch {
    return null;
  }

  const beforeLines = normalizePlanContent(planBefore).split('\n');
  const afterLines = normalizePlanContent(planAfter).split('\n');

  for (let i = 0; i < afterLines.length; i++) {
    const before = beforeLines[i] ?? '';
    const after = afterLines[i] ?? '';

    if (before === after) continue;

    // Check [ ] → [x] transition (case-insensitive)
    const wasUnchecked = /\[\s\]/i.test(before);
    const isNowChecked = /\[[xX]\]/.test(after);
    if (wasUnchecked && isNowChecked) {
      const description = after
        .replace(/\[[xX]\]\s*/g, '')
        .replace(/^[-*\s]+/, '')
        .replace(/✅\s*/g, '')
        .trim();
      if (description) return description;
    }

    // Check ✅ gained as prefix or suffix
    const hadCheckmark = /✅/.test(before);
    const hasCheckmark = /✅/.test(after);
    if (!hadCheckmark && hasCheckmark) {
      const description = after
        .replace(/✅\s*/g, '')
        .replace(/\s*✅/g, '')
        .replace(/\[[xX\s]\]\s*/g, '')
        .replace(/^[-*\s]+/, '')
        .trim();
      if (description) return description;
    }
  }

  return null;
}

/**
 * Compose the validate command from detected components.
 * Always includes ralph doctor --ci and ralph grade --ci.
 */
export function composeValidateCommand(testCmd: string | null, typecheckCmd: string | null): string {
  const parts: string[] = [];

  if (testCmd) parts.push(testCmd);
  if (typecheckCmd) parts.push(typecheckCmd);
  parts.push('ralph doctor --ci');
  parts.push('ralph grade --ci');

  return parts.join(' && ');
}
