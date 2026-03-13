import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import type { AdversarialConfig } from '../../config/schema.js';
import { warn } from '../../utils/output.js';

export interface TestSnapshot {
  testFiles: string[];
  testCount: number | null;
}

// ---------------------------------------------------------------------------
// Glob matching helpers
// ---------------------------------------------------------------------------

/**
 * Expand brace expressions in a glob pattern.
 * e.g. "*.{ts,js}" → ["*.ts", "*.js"]
 */
function expandBraces(pattern: string): string[] {
  const match = /\{([^}]+)\}/.exec(pattern);
  if (!match) return [pattern];
  const full = match[0];
  const inner = match[1] as string;
  const idx = pattern.indexOf(full);
  const before = pattern.slice(0, idx);
  const after = pattern.slice(idx + full.length);
  return inner.split(',').flatMap(p => expandBraces(before + p + after));
}

/**
 * Convert a single (brace-free) glob pattern into a regex string.
 * Handles: ** (any path segments), * (non-separator chars), ? (single non-separator char).
 */
function globPartToRegex(pattern: string): string {
  let result = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i] as string;
    if (ch === '*' && pattern[i + 1] === '*') {
      result += '.*';
      i += 2;
      if (pattern[i] === '/') i++; // consume trailing slash after **
    } else if (ch === '*') {
      result += '[^/]*';
      i++;
    } else if (ch === '?') {
      result += '[^/]';
      i++;
    } else if (/[.+^$|()[\]\\]/.test(ch)) {
      result += '\\' + ch;
      i++;
    } else {
      result += ch;
      i++;
    }
  }
  return result;
}

function globToRegex(pattern: string): RegExp {
  const parts = expandBraces(pattern).map(globPartToRegex);
  return new RegExp('^(' + parts.join('|') + ')$');
}

function matchesPatterns(file: string, patterns: string[]): boolean {
  return patterns.some(pattern => {
    try {
      return globToRegex(pattern).test(file);
    } catch {
      return false;
    }
  });
}

// ---------------------------------------------------------------------------
// File restriction enforcement (AC-3)
// ---------------------------------------------------------------------------

/**
 * After the adversary runs, revert any changes to non-test or restricted files.
 * Returns the list of reverted/removed paths.
 */
export function enforceFileRestriction(config: AdversarialConfig): { reverted: string[] } {
  const reverted: string[] = [];

  // Step 1 & 2: Revert tracked changed files that are not test files or are restricted
  let changedFiles: string[] = [];
  try {
    const output = execSync('git diff --name-only HEAD', { encoding: 'utf8' });
    changedFiles = output
      .trim()
      .split('\n')
      .filter(f => f.length > 0);
  } catch {
    // no changes or git not available
  }

  for (const file of changedFiles) {
    const isTestFile = matchesPatterns(file, config['test-patterns']);
    const isRestricted = matchesPatterns(file, config['restricted-patterns']);
    if (!isTestFile || isRestricted) {
      try {
        execSync(`git checkout HEAD -- ${JSON.stringify(file)}`, { stdio: 'pipe' });
        reverted.push(file);
      } catch {
        // ignore revert errors
      }
    }
  }

  // Step 3: Delete untracked new files that are not test files
  let untrackedFiles: string[] = [];
  try {
    const output = execSync('git ls-files --others --exclude-standard', { encoding: 'utf8' });
    untrackedFiles = output
      .trim()
      .split('\n')
      .filter(f => f.length > 0);
  } catch {
    // no untracked files
  }

  for (const file of untrackedFiles) {
    const isTestFile = matchesPatterns(file, config['test-patterns']);
    if (!isTestFile) {
      try {
        rmSync(file, { force: true });
        reverted.push(file);
      } catch {
        // ignore removal errors
      }
    }
  }

  if (reverted.length > 0) {
    warn(
      `Adversary modified ${reverted.length} restricted file(s) — changes reverted: ${reverted.join(', ')}`,
    );
  }

  return { reverted };
}

// ---------------------------------------------------------------------------
// Test deletion guard (AC-4)
// ---------------------------------------------------------------------------

/**
 * Parse the total passing test count from command output.
 * Supports vitest/jest output formats.
 */
function parseTestCount(output: string): number | null {
  const patterns = [
    /(\d+)\s+passed/i,
    /pass(?:ed)?[:\s]+(\d+)/i,
    /(\d+)\s+tests?\s+passed/i,
    /(\d+)\s+test/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(output);
    if (match?.[1] !== undefined) return parseInt(match[1], 10);
  }
  return null;
}

/**
 * Verify that the adversary did not delete any existing test files or reduce
 * the total test count. Returns `{ abort: true }` if the guard triggers.
 */
export function enforceTestDeletionGuard(
  _config: AdversarialConfig,
  snapshot: TestSnapshot,
  newTestOutput: string,
): { abort: boolean; reason: string } {
  // Check that no pre-adversary test file was deleted
  for (const file of snapshot.testFiles) {
    if (!existsSync(file)) {
      warn(`Adversary deleted test file ${file} — adversarial pass aborted`);
      return { abort: true, reason: `test file deleted: ${file}` };
    }
  }

  // Check that the test count did not decrease
  const newCount = parseTestCount(newTestOutput);
  if (snapshot.testCount !== null && newCount !== null && newCount < snapshot.testCount) {
    warn(
      `Adversary deleted tests (count: ${snapshot.testCount} → ${newCount}) — adversarial pass aborted`,
    );
    return { abort: true, reason: `test count decreased: ${snapshot.testCount} → ${newCount}` };
  }

  return { abort: false, reason: '' };
}
