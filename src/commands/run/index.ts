import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, unlinkSync, rmSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { loadConfig } from '../../config/loader.js';
import * as output from '../../utils/output.js';
import { captureCurrentBranch, captureUntrackedFiles, revertToBaseline } from './git.js';
import { resolveAgent } from './agent.js';
import { spawnAgentWithTimeout } from './timeout.js';
import { detectCompletedTask, normalizePlanContent, composeValidateCommand } from './detect.js';
import { acquireLock, releaseLock } from './lock.js';
import { runValidation } from './validation.js';
import { discoverScorer, runScorer } from '../score/scorer.js';
import { runDefaultScorer } from '../score/default-scorer.js';
import { appendResult } from '../score/results.js';
import { buildScoreContext, computeChangedMetrics } from './scoring.js';
import {
  loadCheckpoint,
  saveCheckpoint,
  printBanner,
  printIterationHeader,
  printIterationSummary,
  printFinalSummary,
  type Checkpoint,
} from './progress.js';
import { generatePrompt, generateAdversarialPrompt } from './prompts.js';
import { runAdversarialPass } from './adversarial.js';
import type { RunMode, RunOptions, AdversarialResult } from './types.js';
import type { ScoreResult } from '../score/types.js';

function isTTY(): boolean {
  return process.stdout.isTTY === true;
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<boolean>((resolve) => {
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'y');
    });
  });
}

function hasChanges(): boolean {
  try {
    const result = execSync('git status --porcelain', { encoding: 'utf8' });
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

function captureHead(): string {
  try {
    return execSync('git rev-parse HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function captureShortHead(): string {
  try {
    return execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function captureGitDescription(): string {
  try {
    return execSync('git log -1 --format=%s HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().slice(0, 72);
  } catch {
    return '';
  }
}

function gitCommit(prefix: string, task: string | null, mode: RunMode, iteration: number): string | null {
  // null and undefined are distinct: null = no completed task detected, use iteration fallback
  const msg = task !== null
    ? `${prefix} ${task}`
    : mode === 'plan'
      ? `${prefix} plan iteration ${iteration}`
      : `${prefix} iteration ${iteration}`;
  try {
    execSync('git add -A', { stdio: 'pipe' });
    execSync(`git commit -m ${JSON.stringify(msg)}`, { stdio: 'pipe' });
    return captureShortHead();
  } catch {
    return null;
  }
}

function gitPush(): void {
  try {
    execSync('git push', { stdio: 'pipe' });
  } catch (err) {
    output.warn(`git push failed: ${(err as Error).message}`);
  }
}

function readPlanFile(): string {
  try {
    return readFileSync('IMPLEMENTATION_PLAN.md', 'utf-8');
  } catch {
    return '';
  }
}

function extractTestCount(metricsStr: string): number | null {
  const match = /test_count=(\d+)/.exec(metricsStr);
  if (match == null) return null;
  const n = parseInt(match[1]!, 10);
  return isNaN(n) ? null : n;
}

export async function runCommand(mode: RunMode, options: RunOptions): Promise<void> {
  // Flag validation (pre-loop)
  if (options.simplify === true && mode === 'plan') {
    output.error('--simplify cannot be combined with --mode plan');
    process.exit(1);
    return;
  }
  if (options.noScore === true && options.simplify === true) {
    output.error('--no-score cannot be combined with --simplify');
    process.exit(1);
    return;
  }
  if (options.noScore === true && options.baselineScore !== undefined) {
    output.error('--no-score cannot be combined with --baseline-score');
    process.exit(1);
    return;
  }
  if (options.baselineScore !== undefined && mode === 'plan') {
    output.error('--baseline-score cannot be combined with --mode plan');
    process.exit(1);
    return;
  }
  if (options.baselineScore !== undefined && (options.baselineScore < 0 || options.baselineScore > 1)) {
    output.error('--baseline-score must be between 0.0 and 1.0');
    process.exit(1);
    return;
  }

  const { config } = loadConfig();
  const runConfig = config.run!; // mergeWithDefaults always fills run
  const maxIterations = options.max !== undefined ? options.max : runConfig.loop['max-iterations'];
  const effectiveAutoCommit = runConfig.git['auto-commit'] && options.noCommit !== true;
  const effectiveAutoPush = runConfig.git['auto-push'] && options.noPush !== true;

  const agentConfig = resolveAgent(mode, runConfig, options.agent, options.model);

  // Load or create checkpoint
  const existing = loadCheckpoint();
  let checkpoint: Checkpoint;

  if (options.resume === true && existing !== null) { // null = no checkpoint file found
    if (existing.phase !== mode) {
      if (isTTY()) {
        output.warn(`Checkpoint is from a "${existing.phase}" run, but running "${mode}" mode.`);
        const useSaved = await confirm(`Resume as "${existing.phase}"?`);
        checkpoint = useSaved
          ? existing
          : { version: 1, phase: mode, startedAt: new Date().toISOString(), iteration: 0, history: [] };
      } else {
        output.error(
          `Checkpoint phase mismatch: checkpoint is "${existing.phase}", requested "${mode}". ` +
          `Use --resume with matching mode.`,
        );
        process.exit(1);
        return;
      }
    } else {
      checkpoint = existing;
    }
  } else {
    checkpoint = { version: 1, phase: mode, startedAt: new Date().toISOString(), iteration: 0, history: [] };
  }

  // Store --baseline-score in checkpoint for resume persistence (AC-69)
  if (options.baselineScore !== undefined) {
    checkpoint.baselineScore = options.baselineScore;
  }
  const effectiveBaselineScore = checkpoint.baselineScore ?? undefined;

  let iteration = checkpoint.iteration;

  // Pre-flight checks
  if (mode === 'plan') {
    const specsDir = config.paths.specs;
    const specsEmpty = !existsSync(specsDir) || readdirSync(specsDir).length === 0;
    if (specsEmpty) {
      output.error(`No specs found in ${specsDir}. Write specs first.`);
      process.exit(1);
      return;
    }

    if (options.resume !== true && existsSync('IMPLEMENTATION_PLAN.md')) {
      if (isTTY()) {
        const regen = await confirm('IMPLEMENTATION_PLAN.md already exists. Regenerate?');
        if (!regen) return;
      }
      // non-TTY: proceed without confirmation (regenerate)
    }
  } else {
    // Build mode
    if (!existsSync('IMPLEMENTATION_PLAN.md')) {
      if (isTTY()) {
        output.warn('No IMPLEMENTATION_PLAN.md found. Run `ralph run plan` first.');
        const cont = await confirm('Continue anyway?');
        if (!cont) return;
      } else {
        output.warn('No IMPLEMENTATION_PLAN.md found. Continuing anyway.');
      }
    }
  }

  // Dirty working tree check
  if (effectiveAutoCommit && hasChanges()) {
    if (isTTY()) {
      output.warn('Working tree has uncommitted changes.');
      const cont = await confirm('Continue?');
      if (!cont) return;
    } else {
      output.warn('Working tree has uncommitted changes. Continuing.');
    }
  }

  // Dry run
  if (options.dryRun === true) {
    const prompt = generatePrompt(mode, config, {
      simplify: options.simplify,
      lastScore: checkpoint.lastScore,
      lastMetrics: checkpoint.lastMetrics ?? undefined,
    });
    output.plain(prompt);

    const dryRunValidation = config.run?.validation;
    const explicitStages = dryRunValidation?.stages;
    if (explicitStages !== undefined && explicitStages.length > 0) {
      output.info('\nValidation stages:');
      const rows = explicitStages.map((s) => {
        const timeout = s.timeout !== undefined ? `${s.timeout}s` : 'default';
        const req = s.required ? 'required' : 'optional';
        const dep = s['run-after'] !== undefined ? ` (after: ${s['run-after']})` : '';
        return `  ${s.name}  [${req}, timeout: ${timeout}${dep}]  ${s.command}`;
      });
      output.plain(rows.join('\n'));
    } else {
      const testCmd = dryRunValidation?.['test-command'] ?? null;
      const typecheckCmd = dryRunValidation?.['typecheck-command'] ?? null;
      const validateCmd = composeValidateCommand(testCmd, typecheckCmd);
      output.info('\nValidate command:');
      output.plain(`  ${validateCmd}`);
    }

    if (config.run?.adversarial?.enabled === true) {
      const adversarialPrompt = generateAdversarialPrompt({
        builderDiff: '(placeholder diff)',
        specContent: '(placeholder spec)',
        existingTests: '(placeholder tests)',
        stageResults: null,
        budget: config.run.adversarial.budget,
        testCommand: config.run.validation['test-command'] ?? '',
      });
      output.info('\nAdversarial prompt:');
      output.plain(adversarialPrompt);
    }

    return;
  }

  // Acquire run lock (applies to both plan and build modes)
  acquireLock(options.force ?? false);

  // Signal handling
  let stopping = false;
  let firstSigintTime = 0;

  const onStop = (force: boolean): void => {
    stopping = true;
    releaseLock();
    if (!force) {
      try { saveCheckpoint(checkpoint); } catch { /* ignore */ }
      printFinalSummary('interrupted', checkpoint);
      process.exit(0);
    } else {
      process.exit(1);
    }
  };

  process.on('SIGINT', () => {
    const now = Date.now();
    if (firstSigintTime > 0 && now - firstSigintTime < 2000) {
      onStop(true);
      return;
    }
    firstSigintTime = now;
    onStop(false);
  });

  process.on('SIGTERM', () => {
    onStop(false);
  });

  // Print banner
  const effectiveRunConfig = maxIterations !== runConfig.loop['max-iterations']
    ? { ...runConfig, loop: { ...runConfig.loop, 'max-iterations': maxIterations } }
    : runConfig;
  printBanner(mode, agentConfig, effectiveRunConfig);

  let noChangesCount = 0;

  // Score context state (build mode only)
  let scoreContext: string | undefined;
  const scoringConfig = config.scoring;
  const regressionThreshold = scoringConfig?.['regression-threshold'] ?? 0.02;
  const cumulativeThreshold = scoringConfig?.['cumulative-threshold'] ?? 0.10;
  const autoRevert = scoringConfig?.['auto-revert'] ?? true;
  const iterationTimeoutSecs = runConfig.loop['iteration-timeout'];

  // On resume: restore to baseline commit if available (prevents mid-iteration crash poison)
  if (options.resume === true && checkpoint.baselineCommit != null) {
    try {
      execSync(`git cat-file -t ${checkpoint.baselineCommit}`, { stdio: 'pipe' });
      execSync(`git reset --hard ${checkpoint.baselineCommit}`, { stdio: 'pipe' });
    } catch { /* ignore — fall back to current HEAD */ }
  }

  // Main loop
  while (true) {
    if (maxIterations > 0 && iteration >= maxIterations) {
      printFinalSummary('max iterations reached', checkpoint);
      break;
    }

    iteration++;

    // ── Build mode: capture pre-iteration state ──
    let baselineCommit = '';
    let originalBranch = '';
    let preAgentUntracked: string[] = [];
    let keepExistedBeforeAgent = false;

    if (mode === 'build') {
      baselineCommit = captureHead();
      checkpoint.baselineCommit = baselineCommit;

      originalBranch = captureCurrentBranch();
      preAgentUntracked = captureUntrackedFiles();
      keepExistedBeforeAgent = existsSync('.ralph/keep');
    }

    const planBefore = readPlanFile();
    const prompt = generatePrompt(mode, config, {
      scoreContext,
      simplify: options.simplify,
      lastScore: checkpoint.lastScore,
      lastMetrics: checkpoint.lastMetrics ?? undefined,
    });

    printIterationHeader(iteration);

    // Use timeout wrapper (passthrough when timeout=0 or plan mode)
    const effectiveTimeout = mode === 'build' ? iterationTimeoutSecs : 0;
    const result = await spawnAgentWithTimeout(agentConfig, prompt, effectiveTimeout, { verbose: options.verbose });

    if (stopping) break;

    // ── Build mode: full scoring/validation/revert logic ──
    if (mode === 'build') {
      const durationS = Math.round(result.durationMs / 1000);

      // Handle timeout
      const isTimedOut = result.timedOut === true ||
        (result.error != null && /timed out/i.test(result.error));

      if (isTimedOut) {
        const description = captureGitDescription();
        revertToBaseline(baselineCommit, originalBranch, preAgentUntracked);
        const headAfterRevert = captureShortHead();

        appendResult({
          commit: headAfterRevert,
          iteration,
          status: 'timeout',
          score: null,
          delta: null,
          durationS,
          metrics: '—',
          description,
        });

        scoreContext = buildScoreContext({
          previousStatus: 'timeout',
          previousScore: checkpoint.lastScore ?? null,
          currentScore: null,
          delta: null,
          metrics: '—',
          changedMetrics: '—',
          timeoutSeconds: iterationTimeoutSecs,
          regressionThreshold,
          previousTestCount: null,
          currentTestCount: null,
          failedStage: null,
          stageResults: null,
        });

        noChangesCount++;
        checkpoint.iteration = iteration;
        checkpoint.history.push({
          iteration,
          durationMs: result.durationMs,
          exitCode: result.exitCode,
          commit: null,
          error: result.error ?? null,
        });
        saveCheckpoint(checkpoint);
        printIterationSummary(iteration, result, null, null);

        const stallThreshold = runConfig.loop['stall-threshold'];
        if (stallThreshold > 0 && noChangesCount >= stallThreshold) {
          printFinalSummary(`stalled — no changes in ${noChangesCount} iterations`, checkpoint);
          break;
        }
        continue;
      }

      if (result.error !== undefined) {
        output.warn(`Agent spawn failed: ${result.error}`);
      } else if (result.exitCode !== 0) {
        output.warn(`Agent exited with code ${result.exitCode}`);
      }

      // Detect new work: uncommitted changes OR new commits since baseline
      const currentHead = captureHead();
      const hasNewWork = hasChanges() || (currentHead !== baselineCommit);

      if (!hasNewWork) {
        noChangesCount++;
        checkpoint.iteration = iteration;
        checkpoint.history.push({
          iteration,
          durationMs: result.durationMs,
          exitCode: result.exitCode,
          commit: null,
          error: result.error ?? null,
        });
        saveCheckpoint(checkpoint);
        printIterationSummary(iteration, result, null, null);

        const stallThreshold = runConfig.loop['stall-threshold'];
        if (stallThreshold > 0 && noChangesCount >= stallThreshold) {
          if (isTTY()) {
            output.warn(`${noChangesCount} iterations with no changes.`);
            const cont = await confirm('Continue?');
            if (cont) {
              noChangesCount = 0;
            } else {
              printFinalSummary(`stalled — no changes in ${noChangesCount} iterations`, checkpoint);
              break;
            }
          } else {
            printFinalSummary(`stalled — no changes in ${noChangesCount} iterations`, checkpoint);
            break;
          }
        }
        continue;
      }

      // Has new work: reset stall counter
      noChangesCount = 0;

      // Capture description from agent's latest commit
      let description = captureGitDescription();

      // Run post-agent validation
      const validationResult = runValidation(runConfig);
      if (!validationResult.passed) {
        revertToBaseline(baselineCommit, originalBranch, preAgentUntracked);
        const headAfterRevert = captureShortHead();

        const stageResultsStr = validationResult.stages.length > 0
          ? validationResult.stages.map((s) => {
            const status = s.skipped ? 'skip' : s.passed ? 'pass' : 'fail';
            return `${s.name}:${status}`;
          }).join(',')
          : null;

        appendResult({
          commit: headAfterRevert,
          iteration,
          status: 'fail',
          score: null,
          delta: null,
          durationS,
          metrics: '—',
          description,
          stages: stageResultsStr ?? undefined,
        });

        scoreContext = buildScoreContext({
          previousStatus: 'fail',
          previousScore: checkpoint.lastScore ?? null,
          currentScore: null,
          delta: null,
          metrics: '—',
          changedMetrics: '—',
          timeoutSeconds: iterationTimeoutSecs,
          regressionThreshold,
          previousTestCount: null,
          currentTestCount: null,
          failedStage: validationResult.failedStage,
          stageResults: stageResultsStr,
        });

        checkpoint.iteration = iteration;
        checkpoint.history.push({
          iteration,
          durationMs: result.durationMs,
          exitCode: result.exitCode,
          commit: null,
          error: result.error ?? null,
        });
        saveCheckpoint(checkpoint);
        printIterationSummary(iteration, result, null, null);
        continue;
      }

      // Auto-commit after validation passes
      let commitHash: string | null = null;
      let task: string | null = null;
      if (effectiveAutoCommit && hasChanges()) {
        task = detectCompletedTask(planBefore);
        commitHash = gitCommit(runConfig.git['commit-prefix'], task, mode, iteration);
        // Update description to reflect ralph's commit message
        description = captureGitDescription();
      }

      // Adversarial pass (between auto-commit and scoring)
      let adversarialResult: AdversarialResult | null = null;
      if (runConfig.adversarial?.enabled === true) {
        const stageResultsStr = validationResult.stages.length > 0
          ? validationResult.stages.map((s) => {
            const status = s.skipped ? 'skip' : s.passed ? 'pass' : 'fail';
            return `${s.name}:${status}`;
          }).join(',')
          : null;
        adversarialResult = await runAdversarialPass({
          config: runConfig.adversarial,
          runConfig,
          iteration,
          baselineCommit,
          originalBranch,
          preBuilderUntracked: preAgentUntracked,
          stageResults: stageResultsStr,
          isSimplify: options.simplify === true,
          effectiveAutoCommit,
          verbose: options.verbose,
        });

        if (adversarialResult.outcome === 'fail') {
          // runAdversarialPass already reverted to baseline
          const headAfterRevert = captureShortHead();
          appendResult({
            commit: headAfterRevert,
            iteration,
            status: 'adversarial-fail',
            score: null,
            delta: null,
            durationS,
            metrics: '—',
            description: `${description} [adversary found ${adversarialResult.failedTests.length} bug(s)]`,
          });
          scoreContext = buildScoreContext({
            previousStatus: 'adversarial-fail',
            previousScore: checkpoint.lastScore ?? null,
            currentScore: null,
            delta: null,
            metrics: '—',
            changedMetrics: '—',
            timeoutSeconds: iterationTimeoutSecs,
            regressionThreshold,
            previousTestCount: adversarialResult.testCountBefore,
            currentTestCount: adversarialResult.testCountAfter,
            failedStage: null,
            stageResults: null,
            adversarialResult,
          });
          checkpoint.iteration = iteration;
          checkpoint.history.push({
            iteration,
            durationMs: result.durationMs,
            exitCode: result.exitCode,
            commit: null,
            error: result.error ?? null,
          });
          saveCheckpoint(checkpoint);
          printIterationSummary(iteration, result, null, null);
          continue;
        }

        if (adversarialResult.outcome === 'pass') {
          description += ` [+${adversarialResult.testFilesAdded.length} adversarial tests]`;
          commitHash = captureShortHead(); // reflect commit B
        }
        // outcome === 'skip': no change to description or commitHash
      }

      // Scoring (skip if --no-score)
      if (options.noScore !== true) {
        // Capture pre-scoring state for dirty check
        const preScoringHead = captureHead();
        const preScoringStatus = execSync('git status --porcelain', {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();

        const scoringCommit = captureShortHead();

        // Run scorer
        let scoreResult: ScoreResult;
        let usedScriptPath: string | null = null;
        try {
          usedScriptPath = discoverScorer(scoringConfig);
        } catch (err) {
          output.warn(`Scorer discovery failed: ${(err as Error).message}`);
        }

        if (usedScriptPath !== null) {
          scoreResult = await runScorer(usedScriptPath, iteration, scoringCommit);
          if (scoreResult.source === 'default') {
            // EACCES fallback to default scorer
            scoreResult = runDefaultScorer(validationResult.testOutput, config);
            usedScriptPath = null;
          }
        } else {
          scoreResult = runDefaultScorer(validationResult.testOutput, config);
        }

        const currMetricsStr = Object.entries(scoreResult.metrics).map(([k, v]) => `${k}=${v}`).join(' ') || '—';
        const newScore = scoreResult.score;

        // Post-scoring dirty check (custom scripts only)
        if (usedScriptPath !== null) {
          const postScoringHead = captureHead();
          const postScoringStatus = execSync('git status --porcelain', {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
          }).trim();

          if (postScoringHead !== preScoringHead) {
            output.warn(`Score script created commits — reverting HEAD to ${preScoringHead}`);
            try {
              execSync(`git reset --hard ${preScoringHead}`, { stdio: 'pipe' });
            } catch { /* ignore */ }
          } else if (postScoringStatus !== preScoringStatus) {
            const preLines = new Set(preScoringStatus.split('\n').filter(Boolean));
            const newDirty = postScoringStatus.split('\n').filter(l => l && !preLines.has(l));
            output.warn(`Score script modified working tree — restoring (files: ${newDirty.join(', ')})`);
            try { execSync('git checkout -- .', { stdio: 'pipe' }); } catch { /* ignore */ }
            for (const line of newDirty) {
              if (line.startsWith('??')) {
                const filePath = line.slice(3).trim();
                try { rmSync(filePath, { recursive: true, force: true }); } catch { /* ignore */ }
              }
            }
          }
        }

        if (newScore === null) {
          // No score obtained: log pass (unscored)
          const headCommit = captureShortHead();
          appendResult({
            commit: headCommit,
            iteration,
            status: 'pass',
            score: null,
            delta: null,
            durationS,
            metrics: currMetricsStr,
            description,
          });

          scoreContext = undefined;

          checkpoint.iteration = iteration;
          checkpoint.lastMetrics = currMetricsStr;
          checkpoint.history.push({
            iteration,
            durationMs: result.durationMs,
            exitCode: result.exitCode,
            commit: commitHash,
            error: result.error ?? null,
          });
          saveCheckpoint(checkpoint);

          if (effectiveAutoPush) gitPush();
          printIterationSummary(iteration, result, commitHash, task);
          // No stall check needed (noChangesCount was reset to 0)
          continue;
        }

        // Score obtained — run regression checks
        const prevLastScore = checkpoint.lastScore ?? null;
        const prevBestScore = checkpoint.bestScore ?? null;
        const prevMetricsStr = checkpoint.lastMetrics ?? '—';
        const prevTestCount = extractTestCount(prevMetricsStr);
        const currTestCount = extractTestCount(currMetricsStr);

        // Determine keep signal
        let validKeepSignal = false;
        let keepReason = 'no reason';
        if (existsSync('.ralph/keep')) {
          if (keepExistedBeforeAgent) {
            validKeepSignal = true;
            try {
              keepReason = readFileSync('.ralph/keep', 'utf-8').trim().slice(0, 100) || 'no reason';
            } catch { keepReason = 'no reason'; }
          } else {
            output.warn('`.ralph/keep` created during agent execution — ignored');
            try { unlinkSync('.ralph/keep'); } catch { /* ignore */ }
          }
        }

        // First scored iteration: record as baseline
        if (prevLastScore === null && (effectiveBaselineScore === undefined || effectiveBaselineScore === null)) {
          const headCommit = captureShortHead();
          appendResult({
            commit: headCommit,
            iteration,
            status: 'pass',
            score: newScore,
            delta: null,
            durationS,
            metrics: currMetricsStr,
            description,
          });

          checkpoint.lastScore = newScore;
          checkpoint.bestScore = newScore;
          checkpoint.lastScoredIteration = iteration;
          checkpoint.consecutiveDiscards = 0;
          checkpoint.bestDiscardedScore = null;
          checkpoint.lastMetrics = currMetricsStr;

          if (validKeepSignal) {
            try { unlinkSync('.ralph/keep'); } catch { /* ignore */ }
          }

          scoreContext = buildScoreContext({
            previousStatus: 'pass',
            previousScore: null,
            currentScore: newScore,
            delta: null,
            metrics: currMetricsStr,
            changedMetrics: '(none)',
            timeoutSeconds: iterationTimeoutSecs,
            regressionThreshold,
            previousTestCount: prevTestCount,
            currentTestCount: currTestCount,
            failedStage: null,
            stageResults: null,
            adversarialResult,
          });

          checkpoint.iteration = iteration;
          checkpoint.history.push({
            iteration,
            durationMs: result.durationMs,
            exitCode: result.exitCode,
            commit: commitHash,
            error: result.error ?? null,
          });
          saveCheckpoint(checkpoint);

          if (effectiveAutoPush) gitPush();
          printIterationSummary(iteration, result, commitHash, task);
          continue;
        }

        // Determine comparison baseline
        const comparisonScore = (effectiveBaselineScore !== undefined &&
          effectiveBaselineScore !== null &&
          prevLastScore === null)
          ? effectiveBaselineScore
          : (prevLastScore ?? newScore);

        const delta = newScore - comparisonScore;
        const bestScore = prevBestScore ?? newScore;
        const cumulativeDrop = bestScore - newScore;
        const changedMetrics = computeChangedMetrics(prevMetricsStr, currMetricsStr);

        // Per-iteration regression check
        if (!autoRevert) {
          // auto-revert: false — regressions logged but not reverted
          let finalDesc = description;
          if (delta < -regressionThreshold) {
            finalDesc += ` [regression ignored: delta ${delta.toFixed(3)}]`;
          }

          const headCommit = captureShortHead();
          appendResult({
            commit: headCommit,
            iteration,
            status: 'pass',
            score: newScore,
            delta: prevLastScore !== null ? delta : null,
            durationS,
            metrics: currMetricsStr,
            description: finalDesc,
          });

          // Update checkpoint (always update scores in auto-revert:false mode)
          checkpoint.lastScore = newScore;
          checkpoint.bestScore = Math.max(newScore, prevBestScore ?? newScore);
          checkpoint.lastScoredIteration = iteration;
          checkpoint.lastMetrics = currMetricsStr;

          if (validKeepSignal) {
            try { unlinkSync('.ralph/keep'); } catch { /* ignore */ }
          }

          scoreContext = buildScoreContext({
            previousStatus: 'pass',
            previousScore: prevLastScore,
            currentScore: newScore,
            delta: prevLastScore !== null ? delta : null,
            metrics: currMetricsStr,
            changedMetrics,
            timeoutSeconds: iterationTimeoutSecs,
            regressionThreshold,
            previousTestCount: prevTestCount,
            currentTestCount: currTestCount,
            failedStage: null,
            stageResults: null,
            adversarialResult,
          });

          checkpoint.iteration = iteration;
          checkpoint.history.push({
            iteration,
            durationMs: result.durationMs,
            exitCode: result.exitCode,
            commit: commitHash,
            error: result.error ?? null,
          });
          saveCheckpoint(checkpoint);

          if (effectiveAutoPush) gitPush();
          printIterationSummary(iteration, result, commitHash, task);
          continue;
        }

        // auto-revert: true — check for regression
        if (delta < -regressionThreshold && !validKeepSignal) {
          // Regression detected: revert and discard
          revertToBaseline(baselineCommit, originalBranch, preAgentUntracked);
          const headAfterRevert = captureShortHead();

          checkpoint.consecutiveDiscards = (checkpoint.consecutiveDiscards ?? 0) + 1;
          const newBestDiscarded = Math.max(
            newScore,
            checkpoint.bestDiscardedScore ?? -Infinity,
          );
          checkpoint.bestDiscardedScore = newBestDiscarded;

          let discardDesc = description;
          if ((checkpoint.consecutiveDiscards) >= 3) {
            // Baseline recalibration
            const recalibratedScore = checkpoint.bestDiscardedScore ?? newScore;
            const oldBest = checkpoint.bestScore ?? comparisonScore;
            discardDesc += ` [baseline recalibrated from ${oldBest.toFixed(3)} to ${recalibratedScore.toFixed(3)}]`;

            checkpoint.lastScore = recalibratedScore;
            checkpoint.bestScore = recalibratedScore;
            checkpoint.consecutiveDiscards = 0;
            checkpoint.bestDiscardedScore = null;
          }

          appendResult({
            commit: headAfterRevert,
            iteration,
            status: 'discard',
            score: newScore,
            delta,
            durationS,
            metrics: currMetricsStr,
            description: discardDesc,
          });

          scoreContext = buildScoreContext({
            previousStatus: 'discard',
            previousScore: comparisonScore,
            currentScore: newScore,
            delta,
            metrics: currMetricsStr,
            changedMetrics,
            timeoutSeconds: iterationTimeoutSecs,
            regressionThreshold,
            previousTestCount: prevTestCount,
            currentTestCount: currTestCount,
            failedStage: null,
            stageResults: null,
          });

          checkpoint.iteration = iteration;
          checkpoint.history.push({
            iteration,
            durationMs: result.durationMs,
            exitCode: result.exitCode,
            commit: null,
            error: result.error ?? null,
          });
          saveCheckpoint(checkpoint);
          printIterationSummary(iteration, result, null, null);
          continue;
        }

        // Cumulative regression check (only when auto-revert: true)
        if (cumulativeDrop > cumulativeThreshold && !validKeepSignal) {
          revertToBaseline(baselineCommit, originalBranch, preAgentUntracked);
          const headAfterRevert = captureShortHead();

          appendResult({
            commit: headAfterRevert,
            iteration,
            status: 'discard',
            score: newScore,
            delta,
            durationS,
            metrics: currMetricsStr,
            description: description + ' [cumulative regression]',
          });

          scoreContext = buildScoreContext({
            previousStatus: 'discard',
            previousScore: comparisonScore,
            currentScore: newScore,
            delta,
            metrics: currMetricsStr,
            changedMetrics,
            timeoutSeconds: iterationTimeoutSecs,
            regressionThreshold,
            previousTestCount: prevTestCount,
            currentTestCount: currTestCount,
            failedStage: null,
            stageResults: null,
          });

          // Increment consecutiveDiscards for cumulative regression too
          checkpoint.consecutiveDiscards = (checkpoint.consecutiveDiscards ?? 0) + 1;

          checkpoint.iteration = iteration;
          checkpoint.history.push({
            iteration,
            durationMs: result.durationMs,
            exitCode: result.exitCode,
            commit: null,
            error: result.error ?? null,
          });
          saveCheckpoint(checkpoint);
          printIterationSummary(iteration, result, null, null);
          continue;
        }

        // Passed all regression checks — log as pass
        let finalDesc = description;
        if (validKeepSignal) {
          finalDesc += ` [kept: ${keepReason}]`;
          try { unlinkSync('.ralph/keep'); } catch { /* ignore */ }
        }

        const headCommit = captureShortHead();
        appendResult({
          commit: headCommit,
          iteration,
          status: 'pass',
          score: newScore,
          delta: prevLastScore !== null ? delta : null,
          durationS,
          metrics: currMetricsStr,
          description: finalDesc,
        });

        checkpoint.lastScore = newScore;
        checkpoint.bestScore = Math.max(newScore, prevBestScore ?? newScore);
        checkpoint.lastScoredIteration = iteration;
        checkpoint.consecutiveDiscards = 0;
        checkpoint.bestDiscardedScore = null;
        checkpoint.lastMetrics = currMetricsStr;

        scoreContext = buildScoreContext({
          previousStatus: 'pass',
          previousScore: prevLastScore,
          currentScore: newScore,
          delta: prevLastScore !== null ? delta : null,
          metrics: currMetricsStr,
          changedMetrics,
          timeoutSeconds: iterationTimeoutSecs,
          regressionThreshold,
          previousTestCount: prevTestCount,
          currentTestCount: currTestCount,
          failedStage: null,
          stageResults: null,
          adversarialResult,
        });

        checkpoint.iteration = iteration;
        checkpoint.history.push({
          iteration,
          durationMs: result.durationMs,
          exitCode: result.exitCode,
          commit: commitHash,
          error: result.error ?? null,
        });
        saveCheckpoint(checkpoint);

        if (effectiveAutoPush) gitPush();
        printIterationSummary(iteration, result, commitHash, task);
        continue;

      } else {
        // --no-score: skip scoring, write pass result for fail/timeout (already handled above)
        const headCommit = captureShortHead();
        appendResult({
          commit: headCommit,
          iteration,
          status: 'pass',
          score: null,
          delta: null,
          durationS,
          metrics: '—',
          description,
        });

        checkpoint.iteration = iteration;
        checkpoint.history.push({
          iteration,
          durationMs: result.durationMs,
          exitCode: result.exitCode,
          commit: commitHash,
          error: result.error ?? null,
        });
        saveCheckpoint(checkpoint);

        if (effectiveAutoPush) gitPush();
        printIterationSummary(iteration, result, commitHash, task);
        continue;
      }

    } else {
      // ── Plan mode: original behavior ──
      if (result.error !== undefined) {
        output.warn(`Agent spawn failed: ${result.error}`);
      } else if (result.exitCode !== 0) {
        output.warn(`Agent exited with code ${result.exitCode}`);
      }

      let commitHash: string | null = null;
      let task: string | null = null;

      if (effectiveAutoCommit && hasChanges()) {
        noChangesCount = 0;
        task = detectCompletedTask(planBefore);
        commitHash = gitCommit(runConfig.git['commit-prefix'], task, mode, iteration);
        if (effectiveAutoPush) {
          gitPush();
        }
      } else {
        noChangesCount++;
      }

      checkpoint.iteration = iteration;
      checkpoint.history.push({
        iteration,
        durationMs: result.durationMs,
        exitCode: result.exitCode,
        commit: commitHash,
        error: result.error ?? null,
      });
      saveCheckpoint(checkpoint);

      printIterationSummary(iteration, result, commitHash, task);

      // Plan mode: halt when plan unchanged
      const planAfter = readPlanFile();
      if (normalizePlanContent(planBefore) === normalizePlanContent(planAfter)) {
        printFinalSummary('plan complete', checkpoint);
        break;
      }

      // Stall check (plan mode)
      const stallThreshold = runConfig.loop['stall-threshold'];
      if (stallThreshold > 0 && noChangesCount >= stallThreshold) {
        if (isTTY()) {
          output.warn(`${noChangesCount} iterations with no changes.`);
          const cont = await confirm('Continue?');
          if (cont) {
            noChangesCount = 0;
          } else {
            printFinalSummary(`stalled — no changes in ${noChangesCount} iterations`, checkpoint);
            break;
          }
        } else {
          printFinalSummary(`stalled — no changes in ${noChangesCount} iterations`, checkpoint);
          break;
        }
      }
    }
  }

  releaseLock();
}
