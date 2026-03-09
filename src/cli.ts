#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { configValidateCommand } from './commands/config-validate.js';
import { initCommand } from './commands/init/index.js';
import { lintCommand } from './commands/lint/index.js';
import { gradeCommand } from './commands/grade/index.js';
import { doctorCommand } from './commands/doctor/index.js';
import { planCreateCommand, planCompleteCommand, planAbandonCommand, planLogCommand, planListCommand, planStatusCommand } from './commands/plan/index.js';
import { promoteDocCommand, promoteLintCommand, promotePatternCommand, promoteListCommand } from './commands/promote/index.js';
import { refAddCommand, refListCommand, refUpdateCommand, refRemoveCommand, refDiscoverCommand } from './commands/ref/index.js';
import { gcCommand } from './commands/gc/index.js';
import { hooksInstallCommand, hooksUninstallCommand } from './commands/hooks/index.js';
import { ciGenerateCommand } from './commands/ci/index.js';
import { runCommand } from './commands/run/index.js';
import { reviewCommand } from './commands/review/index.js';
import { healCommand } from './commands/heal/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from package.json
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')) as { version: string };

const program = new Command();

program
  .name('ralph')
  .description('CLI tool that prepares and maintains repositories for AI agent development')
  .version(pkg.version);

// ralph init
program
  .command('init')
  .description('Scaffold an agent-optimized project structure')
  .option('--defaults', 'Non-interactive mode with sensible defaults')
  .action(async (options: { defaults?: boolean }) => {
    await initCommand(options);
  });

// ralph lint
program
  .command('lint [path]')
  .description('Enforce architectural rules')
  .option('--fix', 'Auto-fix violations where possible')
  .option('--json', 'Output structured JSON')
  .option('--rule <name>', 'Run a specific rule')
  .action((path: string | undefined, options: { fix?: boolean; json?: boolean; rule?: string }) => {
    lintCommand(path, options);
  });

// ralph grade
program
  .command('grade [domain]')
  .description('Score domain quality on five dimensions')
  .option('--ci', 'Exit non-zero if below minimum grade')
  .option('--trend', 'Show last N snapshots')
  .action((domain: string | undefined, options: { ci?: boolean; trend?: boolean }) => {
    gradeCommand(domain, options);
  });

// ralph gc
program
  .command('gc')
  .description('Detect drift from golden principles and patterns')
  .option('--json', 'Output structured JSON')
  .option('--fix-descriptions', 'Markdown with one fix task per drift item')
  .option('--severity <level>', 'Filter by severity (critical, warning, info)')
  .option('--category <category>', 'Filter by category (principle-violation, dead-code, stale-documentation, pattern-inconsistency)')
  .action((options: { json?: boolean; fixDescriptions?: boolean; severity?: string; category?: string }) => {
    gcCommand(options);
  });

// ralph doctor
program
  .command('doctor')
  .description('Diagnose repo readiness for AI agent development')
  .option('--json', 'Output structured JSON')
  .option('--ci', 'Exit non-zero if below minimum score')
  .option('--fix', 'Auto-fix missing structure')
  .action((options: { json?: boolean; ci?: boolean; fix?: boolean }) => {
    doctorCommand(options);
  });

// ralph plan
const planCmd = program
  .command('plan')
  .description('Manage execution plans');

planCmd
  .command('create <title>')
  .description('Create a new execution plan')
  .option('--full', 'Create a full structured plan for 4+ tasks')
  .action((title: string, options: { full?: boolean }) => {
    planCreateCommand(title, options);
  });

planCmd
  .command('complete <id>')
  .description('Mark a plan as completed')
  .option('--reason <reason>', 'Reason for completion')
  .action((id: string, options: { reason?: string }) => {
    planCompleteCommand(id, options);
  });

planCmd
  .command('abandon <id>')
  .description('Abandon a plan')
  .option('--reason <reason>', 'Reason for abandonment')
  .action((id: string, options: { reason?: string }) => {
    planAbandonCommand(id, options);
  });

planCmd
  .command('log <id> <decision>')
  .description('Log a decision to a plan')
  .action((id: string, decision: string) => {
    planLogCommand(id, decision);
  });

planCmd
  .command('list')
  .description('List execution plans')
  .option('--all', 'Include completed and abandoned plans')
  .option('--json', 'Output structured JSON')
  .action((options: { all?: boolean; json?: boolean }) => {
    planListCommand(options);
  });

planCmd
  .command('status')
  .description('Show plan summary with completion percentage')
  .option('--json', 'Output structured JSON')
  .action((options: { json?: boolean }) => {
    planStatusCommand(options);
  });

// ralph promote
const promoteCmd = program
  .command('promote')
  .description('Escalate preferences through enforcement ladder');

promoteCmd
  .command('doc <principle>')
  .description('Promote a principle to documentation')
  .option('--to <doc>', 'Target document (e.g., RELIABILITY.md)')
  .action((principle: string, options: { to?: string }) => {
    promoteDocCommand(principle, options);
  });

promoteCmd
  .command('lint <rule-name>')
  .description('Promote a principle to a lint rule')
  .option('--description <desc>', 'Rule description')
  .option('--pattern <pattern>', 'Pattern to match')
  .option('--require <require>', 'Required nearby pattern')
  .option('--fix <fix>', 'Fix suggestion')
  .option('--from <doc>', 'Source document this was promoted from (e.g., core-beliefs.md)')
  .action((ruleName: string, options: { description?: string; pattern?: string; require?: string; fix?: string; from?: string }) => {
    promoteLintCommand(ruleName, options);
  });

promoteCmd
  .command('pattern <name>')
  .description('Promote a principle to a design pattern')
  .option('--description <desc>', 'Pattern description')
  .action((name: string, options: { description?: string }) => {
    promotePatternCommand(name, options);
  });

promoteCmd
  .command('list')
  .description('List all taste rules with enforcement level')
  .action(() => {
    promoteListCommand();
  });

// ralph ref
const refCmd = program
  .command('ref')
  .description('Manage external documentation references');

refCmd
  .command('add <url-or-path>')
  .description('Add a reference')
  .option('--name <name>', 'Name for the reference')
  .action((urlOrPath: string, options: { name?: string }) => {
    refAddCommand(urlOrPath, options);
  });

refCmd
  .command('discover')
  .description('Discover available references from dependencies')
  .action(() => {
    refDiscoverCommand();
  });

refCmd
  .command('list')
  .description('List all references')
  .option('--sizes', 'Show visual size breakdown')
  .action((options: { sizes?: boolean }) => {
    refListCommand(options);
  });

refCmd
  .command('update [name]')
  .description('Re-fetch references from source URLs')
  .action((name?: string) => {
    refUpdateCommand(name);
  });

refCmd
  .command('remove <name>')
  .description('Remove a reference')
  .action((name: string) => {
    refRemoveCommand(name);
  });

// ralph hooks
const hooksCmd = program
  .command('hooks')
  .description('Manage git hooks integration');

hooksCmd
  .command('install')
  .description('Install ralph git hooks')
  .option('--all', 'Install all hooks')
  .option('--hooks <list>', 'Comma-separated list of hooks to install')
  .action((options: { all?: boolean; hooks?: string }) => {
    hooksInstallCommand(options);
  });

hooksCmd
  .command('uninstall')
  .description('Remove ralph git hooks')
  .action(() => {
    hooksUninstallCommand();
  });

// ralph ci
const ciCmd = program
  .command('ci')
  .description('CI/CD integration');

ciCmd
  .command('generate')
  .description('Generate CI configuration')
  .option('--platform <platform>', 'CI platform (github, gitlab, generic)')
  .action((options: { platform?: string }) => {
    ciGenerateCommand(options);
  });

// ralph config
const configCmd = program
  .command('config')
  .description('Configuration management');

configCmd
  .command('validate')
  .description('Validate .ralph/config.yml')
  .action(() => {
    configValidateCommand();
  });

// ralph run
program
  .command('run [mode]')
  .description('Run an AI agent loop (mode: plan or build, default: build)')
  .option('--max <n>', 'Override max iterations', (v) => parseInt(v, 10))
  .option('--agent <cli>', 'Override agent CLI')
  .option('--model <model>', 'Inject/override model in agent args')
  .option('--dry-run', 'Show generated prompt without executing')
  .option('--no-commit', 'Skip git commits')
  .option('--no-push', 'Skip git push')
  .option('--resume', 'Resume from last checkpoint')
  .option('--verbose', 'Show full agent output')
  .action(async (mode: string | undefined, options: {
    max?: number;
    agent?: string;
    model?: string;
    dryRun?: boolean;
    commit: boolean;
    push: boolean;
    resume?: boolean;
    verbose?: boolean;
  }) => {
    const resolvedMode = mode ?? 'build';
    if (resolvedMode !== 'plan' && resolvedMode !== 'build') {
      process.stderr.write(`error: invalid mode '${resolvedMode}'. Must be 'plan' or 'build'.\n`);
      process.exit(1);
    }
    await runCommand(resolvedMode, {
      max: options.max,
      agent: options.agent,
      model: options.model,
      dryRun: options.dryRun,
      noCommit: options.commit === false ? true : undefined,
      noPush: options.push === false ? true : undefined,
      resume: options.resume,
      verbose: options.verbose,
    });
  });

// ralph review
program
  .command('review [target]')
  .description('Feed code changes to a coding agent for semantic review')
  .option('--scope <scope>', 'What to review: staged, commit, range, or working')
  .option('--agent <cli>', 'Override agent CLI')
  .option('--model <model>', 'Inject/override model in agent args')
  .option('--format <fmt>', 'Output format: text, json, or markdown')
  .option('--output <path>', 'Write review output to file')
  .option('--dry-run', 'Show generated prompt without executing')
  .option('--verbose', 'Show full agent output')
  .option('--diff-only', 'Omit architecture/specs/rules from prompt')
  .action(async (target: string | undefined, options: {
    scope?: string;
    agent?: string;
    model?: string;
    format?: string;
    output?: string;
    dryRun?: boolean;
    verbose?: boolean;
    diffOnly?: boolean;
  }) => {
    await reviewCommand(target, options);
  });

// ralph heal
program
  .command('heal')
  .description('Run ralph diagnostics, generate a repair prompt, and apply fixes with an agent')
  .option('--agent <cli>', 'Override agent CLI')
  .option('--model <model>', 'Inject/override model in agent args')
  .option('--only <cmds>', 'Only run specific diagnostics (comma-separated)')
  .option('--skip <cmds>', 'Skip specific diagnostics (comma-separated)')
  .option('--dry-run', 'Show generated prompt without executing')
  .option('--no-commit', 'Skip git commits')
  .option('--verbose', 'Show full agent output')
  .action(async (options: {
    agent?: string;
    model?: string;
    only?: string;
    skip?: string;
    dryRun?: boolean;
    commit: boolean;
    verbose?: boolean;
  }) => {
    await healCommand({
      agent: options.agent,
      model: options.model,
      only: options.only,
      skip: options.skip,
      dryRun: options.dryRun,
      noCommit: options.commit === false ? true : undefined,
      verbose: options.verbose,
    });
  });

program.parse();
