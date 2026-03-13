import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import type { AdversarialConfig, AgentConfig, RunConfig } from '../../config/schema.js';
import { warn } from '../../utils/output.js';
import { AGENT_PRESETS, injectModel } from './agent.js';
import { revertToBaseline } from './git.js';
import { generateAdversarialPrompt } from './prompts.js';
import { spawnAgentWithTimeout } from './timeout.js';
import type { AdversarialResult } from './types.js';

// ---------------------------------------------------------------------------
// Diagnostic branch (AC-7)
// ---------------------------------------------------------------------------

/**
 * Push the current HEAD (commit A + adversary test files) to a diagnostic
 * branch so failing tests can be inspected before the main branch is reverted.
 *
 * Returns the branch name on success, or null if diagnostic branches are
 * disabled or if any git command fails (fail-open).
 */
export function pushDiagnosticBranch(
  iteration: number,
  failureCount: number,
  diagnosticEnabled: boolean,
): string | null {
  if (!diagnosticEnabled) return null;

  const branch = `ralph/adversarial/${iteration}`;
  try {
    execSync(`git checkout -b ${branch}`, { stdio: 'pipe' });
    execSync(
      `git add -A && git commit -m "ralph: adversarial tests (iteration ${iteration}, ${failureCount} failures)"`,
      { stdio: 'pipe' },
    );
    execSync('git checkout -', { stdio: 'pipe' });
    return branch;
  } catch (err) {
    warn(
      `Failed to create diagnostic branch ${branch}: ${err instanceof Error ? err.message : String(err)}`,
    );
    // Attempt to return to original branch on failure
    try {
      execSync('git checkout -', { stdio: 'pipe' });
    } catch {
      // ignore
    }
    return null;
  }
}

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

// ---------------------------------------------------------------------------
// runAdversarialPass() orchestrator (AC-2, AC-5, AC-6, AC-10, AC-11, AC-14, AC-15, AC-16)
// ---------------------------------------------------------------------------

/**
 * List all test files in the working tree (tracked + untracked) matching testPatterns.
 */
function listTestFiles(testPatterns: string[]): string[] {
  const files: string[] = [];
  try {
    const tracked = execSync('git ls-files', { encoding: 'utf8' })
      .trim().split('\n').filter(f => f.length > 0);
    files.push(...tracked);
  } catch { /* ignore */ }
  try {
    const untracked = execSync('git ls-files --others --exclude-standard', { encoding: 'utf8' })
      .trim().split('\n').filter(f => f.length > 0);
    files.push(...untracked);
  } catch { /* ignore */ }
  return files.filter(f => matchesPatterns(f, testPatterns));
}

/**
 * List test files that the adversary has changed (diff vs HEAD + new untracked).
 */
function getChangedTestFiles(testPatterns: string[]): string[] {
  const changed: string[] = [];
  try {
    const diff = execSync('git diff --name-only HEAD', { encoding: 'utf8' })
      .trim().split('\n').filter(f => f.length > 0);
    changed.push(...diff);
  } catch { /* ignore */ }
  try {
    const untracked = execSync('git ls-files --others --exclude-standard', { encoding: 'utf8' })
      .trim().split('\n').filter(f => f.length > 0);
    changed.push(...untracked);
  } catch { /* ignore */ }
  return changed.filter(f => matchesPatterns(f, testPatterns));
}

/**
 * Resolve the test command to use for adversarial test execution.
 * Uses the first stage command if stages are configured, otherwise falls back to test-command.
 */
function getTestCommand(runConfig: RunConfig): string {
  const stages = runConfig.validation.stages;
  if (stages !== undefined && stages.length > 0) {
    const testStage = stages.find(s => s.name === 'test') ?? stages[0]!;
    return testStage.command;
  }
  return runConfig.validation['test-command'] ?? '';
}

/**
 * Run a shell command, capturing combined stdout+stderr.
 * Returns { passed: true } on exit code 0, { passed: false } otherwise.
 */
function runTestCommand(command: string): { passed: boolean; output: string } {
  const result = spawnSync('sh', ['-c', command], { encoding: 'utf-8', timeout: 300_000 });
  const output = [result.stdout ?? '', result.stderr ?? ''].join('\n');
  return { passed: (result.status ?? 1) === 0, output };
}

/**
 * Parse failing test names from test runner output (vitest/jest formats).
 */
function parseFailedTests(output: string): string[] {
  const failed: string[] = [];
  for (const line of output.split('\n')) {
    const m = /[✗✕×]\s+(.+)/.exec(line) ??
              /^\s*FAIL\s+(.+)/.exec(line) ??
              /^\s*●\s+(.+)/.exec(line);
    if (m?.[1] !== undefined) {
      failed.push(m[1].trim());
    }
  }
  return failed;
}

/**
 * Build an AgentConfig for the adversary agent, either from config.agent fields
 * or inherited from runConfig.agent with optional model override.
 */
function buildAdversaryAgentConfig(
  config: AdversarialConfig,
  runConfig: RunConfig,
): AgentConfig {
  if (config.agent !== null) {
    const preset = AGENT_PRESETS[config.agent] ?? {};
    const baseArgs = preset.args ?? [];
    const finalArgs = config.model !== null ? injectModel(baseArgs, config.model) : baseArgs;
    return { cli: config.agent, args: finalArgs, timeout: config.timeout };
  }
  // Inherit from runConfig.agent, override timeout and optionally model
  const inherited = runConfig.agent;
  const finalArgs = config.model !== null ? injectModel(inherited.args, config.model) : inherited.args;
  return { cli: inherited.cli, args: finalArgs, timeout: config.timeout };
}

/**
 * Run an adversarial pass: spawn an adversary agent to write edge-case tests,
 * enforce file restrictions, run the tests, and either commit passing tests (commit B)
 * or revert to baseline on failure.
 */
export async function runAdversarialPass(opts: {
  config: AdversarialConfig;
  runConfig: RunConfig;
  iteration: number;
  baselineCommit: string;
  originalBranch: string;
  preBuilderUntracked: string[];
  stageResults: string | null;
  isSimplify: boolean;
  effectiveAutoCommit: boolean;
  verbose?: boolean | undefined;
}): Promise<AdversarialResult> {
  const {
    config,
    runConfig,
    iteration,
    baselineCommit,
    originalBranch,
    preBuilderUntracked,
    stageResults,
    isSimplify,
    effectiveAutoCommit,
    verbose,
  } = opts;

  const skipResult = (reason: string): AdversarialResult => ({
    outcome: 'skip',
    testFilesAdded: [],
    failedTests: [],
    diagnosticBranch: null,
    testCountBefore: null,
    testCountAfter: null,
    skipReason: reason,
  });

  // Step 1: Skip guards
  if (!effectiveAutoCommit) {
    warn('Adversarial pass skipped: auto-commit is disabled (required for adversarial testing)');
    return skipResult('auto-commit disabled');
  }
  if (isSimplify && config['skip-on-simplify']) {
    return skipResult('simplify mode');
  }

  // Step 2: Capture pre-adversary test snapshot
  const snapshot: TestSnapshot = {
    testFiles: listTestFiles(config['test-patterns']),
    testCount: null,
  };

  // Step 3: Generate adversary prompt
  let builderDiff = '';
  try {
    builderDiff = execSync('git diff HEAD~1 HEAD', { encoding: 'utf8' });
  } catch {
    builderDiff = '(diff unavailable)';
  }

  const specContent = (() => {
    try {
      return readFileSync('IMPLEMENTATION_PLAN.md', 'utf-8').slice(0, 2000);
    } catch {
      return '(IMPLEMENTATION_PLAN.md not found)';
    }
  })();

  const existingTests = (() => {
    const parts: string[] = [];
    let total = 0;
    for (const file of snapshot.testFiles) {
      if (total >= 4000) break;
      try {
        const content = readFileSync(file, 'utf-8');
        const chunk = content.slice(0, 4000 - total);
        parts.push(`// ${file}\n${chunk}`);
        total += chunk.length;
      } catch { /* ignore */ }
    }
    return parts.join('\n\n') || '(no existing tests found)';
  })();

  const testCommand = getTestCommand(runConfig);
  const prompt = generateAdversarialPrompt({
    builderDiff,
    specContent,
    existingTests,
    stageResults,
    budget: config.budget,
    testCommand,
  });

  // Step 4: Resolve adversary agent
  const adversaryConfig = buildAdversaryAgentConfig(config, runConfig);

  // Step 5: Spawn adversary with timeout
  const agentResult = await spawnAgentWithTimeout(adversaryConfig, prompt, config.timeout, { verbose });

  // Step 6: Fail-open on timeout or spawn error — preserve builder commit A
  if (agentResult.timedOut === true) {
    return skipResult('timeout');
  }
  if (agentResult.error !== undefined) {
    warn(`Adversarial agent spawn failed: ${agentResult.error}`);
    return skipResult('spawn failed');
  }

  // Step 7: Enforce file restriction — revert non-test/restricted changes
  enforceFileRestriction(config);

  // Step 8: Check if adversary wrote any test files
  const changedTestFiles = getChangedTestFiles(config['test-patterns']);
  if (changedTestFiles.length === 0) {
    return skipResult('no tests written');
  }

  // Step 9: Run test command to get output for guard and pass/fail determination
  const testRun = runTestCommand(testCommand);
  const testCountAfter = parseTestCount(testRun.output);

  // Step 10: Test deletion guard
  const guard = enforceTestDeletionGuard(config, snapshot, testRun.output);
  if (guard.abort) {
    // Revert adversary's test changes, keep builder commit A
    try {
      execSync('git checkout HEAD -- .', { stdio: 'pipe' });
    } catch { /* ignore */ }
    return skipResult(guard.reason);
  }

  // Step 11: Determine outcome
  if (testRun.passed) {
    // All tests pass — commit adversarial tests as commit B
    const testFilesAdded = changedTestFiles;
    try {
      execSync('git add -A', { stdio: 'pipe' });
      execSync(
        `git commit -m ${JSON.stringify(`ralph: adversarial tests (iteration ${iteration})`)}`,
        { stdio: 'pipe' },
      );
    } catch { /* ignore — commit may fail if nothing to commit */ }
    return {
      outcome: 'pass',
      testFilesAdded,
      failedTests: [],
      diagnosticBranch: null,
      testCountBefore: snapshot.testCount,
      testCountAfter,
    };
  } else {
    // Tests fail — push diagnostic branch, then revert to baseline
    const failedTests = parseFailedTests(testRun.output);
    const diagnosticBranch = pushDiagnosticBranch(
      iteration,
      failedTests.length,
      config['diagnostic-branch'],
    );
    revertToBaseline(baselineCommit, originalBranch, preBuilderUntracked);
    return {
      outcome: 'fail',
      testFilesAdded: [],
      failedTests,
      diagnosticBranch,
      testCountBefore: snapshot.testCount,
      testCountAfter,
    };
  }
}
