import { writeFileSync } from 'node:fs';
import { loadConfig } from '../../config/loader.js';
import * as output from '../../utils/output.js';
import { spawnAgent, injectModel, AGENT_PRESETS } from '../run/agent.js';
import { resolveScope, extractDiff, assembleContext, extractMotivation } from './context.js';
import { generateReviewPrompt } from './prompts.js';
import type { ReviewOptions } from './types.js';
import type { AgentConfig, RalphConfig } from '../../config/schema.js';

const DEFAULT_TIMEOUT = 1800;

function resolveReviewAgent(
  config: RalphConfig,
  cliAgent?: string | undefined,
  cliModel?: string | undefined,
): AgentConfig {
  // Tier 3: run.agent as base default
  let base: AgentConfig = config.run!.agent;

  // Tier 2: review.agent overrides when explicitly configured
  if (config.review!.agent !== null) {
    base = config.review!.agent;
  }

  // Tier 1: CLI flag overrides cli name
  const effectiveCli = cliAgent ?? base.cli;
  let { args, timeout } = base;

  // Tier 4: preset — when CLI changes via --agent flag, use preset args
  if (cliAgent !== undefined && cliAgent !== base.cli) {
    const preset = AGENT_PRESETS[effectiveCli] ?? {};
    args = preset.args ?? [];
    timeout = preset.timeout ?? DEFAULT_TIMEOUT;
  }

  const finalArgs = cliModel !== undefined ? injectModel(args, cliModel) : args;
  return { cli: effectiveCli, args: finalArgs, timeout };
}

export async function reviewCommand(
  target: string | undefined,
  options: ReviewOptions,
): Promise<void> {
  const { config } = loadConfig();
  const reviewConfig = config.review!;

  // Resolve scope
  let scopeInfo: { gitArgs: string[]; scopeLabel: string };
  try {
    scopeInfo = resolveScope(target, options.scope, reviewConfig.scope);
  } catch (e) {
    output.error((e as Error).message);
    process.exit(1);
  }

  // Extract diff
  const contextLines = reviewConfig.context['include-diff-context'];
  let diffData: { diff: string; diffStat: string; changedFiles: string[]; binaryCount: number };
  try {
    diffData = extractDiff(scopeInfo.gitArgs, contextLines);
  } catch (e) {
    output.error((e as Error).message);
    process.exit(1);
  }

  // Edge cases: empty diff
  if (!diffData.diff.trim() && !diffData.diffStat.trim()) {
    const isStaged = (options.scope ?? reviewConfig.scope) === 'staged' && !target;
    if (isStaged) {
      output.error('Nothing to review. Stage changes with `git add` or specify a commit.');
    } else {
      output.error('Diff is empty for the specified range.');
    }
    process.exit(1);
  }

  // Note binary files
  if (diffData.binaryCount > 0) {
    output.warn(`Skipped ${diffData.binaryCount} binary file(s).`);
  }

  // Assemble context
  const maxDiffLines = reviewConfig.context['max-diff-lines'];
  const reviewContext = assembleContext(
    config,
    diffData.diff,
    diffData.diffStat,
    diffData.changedFiles,
    { diffOnly: options.diffOnly ?? false, maxDiffLines },
  );
  reviewContext.scope = scopeInfo.scopeLabel;

  // Populate motivations when --intent is set
  if (options.intent) {
    for (const spec of reviewContext.specs) {
      const motivation = extractMotivation(spec);
      if (motivation !== null) {
        reviewContext.motivations.push(motivation);
      }
    }
  }

  // Generate prompt
  const prompt = generateReviewPrompt(reviewContext, { diffOnly: options.diffOnly ?? false, intent: options.intent ?? false });

  // Dry run — print prompt and exit
  if (options.dryRun) {
    output.plain(prompt);
    return;
  }

  // Resolve agent
  const agentConfig = resolveReviewAgent(config, options.agent, options.model);

  // Spawn agent, capture output
  const result = await spawnAgent(agentConfig, prompt, {
    verbose: options.verbose,
    capture: true,
  });

  if (result.error && result.exitCode !== 0) {
    output.error(result.error);
    process.exit(1);
  }

  const agentOutput = result.output ?? '';
  const format = options.format ?? reviewConfig.output.format;
  const outputFile = options.output ?? reviewConfig.output.file ?? undefined;
  const date = new Date().toISOString().split('T')[0]!;

  // Format output
  let formatted: string;
  if (format === 'json') {
    const jsonOutput = {
      project: config.project.name,
      date,
      scope: scopeInfo.scopeLabel,
      files: diffData.changedFiles,
      review: agentOutput,
      durationMs: result.durationMs,
    };
    formatted = JSON.stringify(jsonOutput, null, 2);
  } else if (format === 'markdown') {
    const fileCount = diffData.changedFiles.length;
    formatted = `# Code Review — ${config.project.name}\n**Date:** ${date}\n**Scope:** ${scopeInfo.scopeLabel}\n**Files:** ${fileCount} changed\n\n---\n\n${agentOutput}`;
  } else {
    formatted = agentOutput;
  }

  // Write output
  if (outputFile) {
    writeFileSync(outputFile, formatted, 'utf-8');
    output.success(`Review written to ${outputFile}`);
  } else {
    output.plain(formatted);
  }
}
