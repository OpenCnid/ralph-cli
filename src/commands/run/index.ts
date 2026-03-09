import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { loadConfig } from '../../config/loader.js';
import * as output from '../../utils/output.js';
import { spawnAgent, resolveAgent } from './agent.js';
import { detectCompletedTask, normalizePlanContent } from './detect.js';
import {
  loadCheckpoint,
  saveCheckpoint,
  printBanner,
  printIterationHeader,
  printIterationSummary,
  printFinalSummary,
  type Checkpoint,
} from './progress.js';
import { generatePrompt } from './prompts.js';
import type { RunMode, RunOptions } from './types.js';

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

function gitCommit(prefix: string, task: string | null, mode: RunMode, iteration: number): string | null {
  const msg = task !== null
    ? `${prefix} ${task}`
    : mode === 'plan'
      ? `${prefix} plan iteration ${iteration}`
      : `${prefix} iteration ${iteration}`;
  try {
    execSync('git add -A', { stdio: 'pipe' });
    execSync(`git commit -m ${JSON.stringify(msg)}`, { stdio: 'pipe' });
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
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

export async function runCommand(mode: RunMode, options: RunOptions): Promise<void> {
  const { config } = loadConfig();
  const runConfig = config.run!; // mergeWithDefaults always fills run
  const maxIterations = options.max !== undefined ? options.max : runConfig.loop['max-iterations'];
  const effectiveAutoCommit = runConfig.git['auto-commit'] && options.noCommit !== true;
  const effectiveAutoPush = runConfig.git['auto-push'] && options.noPush !== true;

  const agentConfig = resolveAgent(mode, runConfig, options.agent, options.model);

  // Load or create checkpoint
  const existing = loadCheckpoint();
  let checkpoint: Checkpoint;

  if (options.resume === true && existing !== null) {
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
    const prompt = generatePrompt(mode, config);
    output.plain(prompt);
    return;
  }

  // Signal handling
  let stopping = false;
  let firstSigintTime = 0;

  const onStop = (force: boolean): void => {
    stopping = true;
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

  // Main loop
  while (true) {
    if (maxIterations > 0 && iteration >= maxIterations) {
      printFinalSummary('max iterations reached', checkpoint);
      break;
    }

    iteration++;

    const planBefore = readPlanFile();
    const prompt = generatePrompt(mode, config);

    printIterationHeader(iteration);

    const result = await spawnAgent(agentConfig, prompt, { verbose: options.verbose });

    if (stopping) break;

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
    if (mode === 'plan') {
      const planAfter = readPlanFile();
      if (normalizePlanContent(planBefore) === normalizePlanContent(planAfter)) {
        printFinalSummary('plan complete', checkpoint);
        break;
      }
    }

    // Stall check
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
