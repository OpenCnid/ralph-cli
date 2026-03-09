import { execSync } from 'node:child_process';
import { loadConfig } from '../../config/loader.js';
import type { AgentConfig, RalphConfig, RunConfig } from '../../config/schema.js';
import * as output from '../../utils/output.js';
import { resolveAgent, spawnAgent } from '../run/agent.js';
import {
  composeValidateCommand,
  detectTestCommand,
  detectTypecheckCommand,
} from '../run/detect.js';
import { formatDuration } from '../run/progress.js';
import { runDiagnostics } from './diagnostics.js';
import { generateHealPrompt } from './prompts.js';
import type { DiagnosticResult, HealOptions } from './types.js';

const DIAGNOSTIC_COMMANDS: Record<string, string> = {
  doctor: 'ralph doctor',
  grade: 'ralph grade --ci',
  gc: 'ralph gc',
  lint: 'ralph lint',
};

function getDiagnosticName(command: string): string {
  if (command.includes('doctor')) return 'doctor';
  if (command.includes('grade')) return 'grade';
  if (command.includes('gc')) return 'gc';
  if (command.includes('lint')) return 'lint';
  return command;
}

function getConfiguredCommands(config: RalphConfig): string[] {
  return config.heal!.commands
    .map((name) => DIAGNOSTIC_COMMANDS[name])
    .filter((command): command is string => command !== undefined);
}

function isCommandExecutionFailure(result: DiagnosticResult): boolean {
  return result.exitCode === 127 || /not found|enoent|permission denied|is not recognized/i.test(result.output);
}

function splitDiagnosticResults(results: DiagnosticResult[]): {
  actionable: DiagnosticResult[];
  skipped: DiagnosticResult[];
} {
  const actionable: DiagnosticResult[] = [];
  const skipped: DiagnosticResult[] = [];

  for (const result of results) {
    if (isCommandExecutionFailure(result)) {
      skipped.push(result);
    } else {
      actionable.push(result);
    }
  }

  return { actionable, skipped };
}

function totalIssues(results: DiagnosticResult[]): number {
  return results.reduce((sum, result) => sum + result.issues, 0);
}

function printDiagnosticSummary(results: DiagnosticResult[]): void {
  output.heading('Issues found');

  for (const result of results) {
    output.info(`${getDiagnosticName(result.command)}: ${result.issues} issue(s)`);
  }

  output.info(`Total: ${totalIssues(results)} issue(s)`);
}

function resolveHealAgent(
  config: RalphConfig,
  cliAgent?: string | undefined,
  cliModel?: string | undefined,
): AgentConfig {
  if (config.heal!.agent === null) {
    return resolveAgent('build', config.run!, cliAgent, cliModel);
  }

  const runConfig: RunConfig = {
    ...config.run!,
    agent: config.heal!.agent,
    'plan-agent': null,
    'build-agent': null,
  };

  return resolveAgent('build', runConfig, cliAgent, cliModel);
}

function isGitRepo(): boolean {
  try {
    const outputText = execSync('git rev-parse --is-inside-work-tree', { encoding: 'utf8' });
    return outputText.trim() === 'true';
  } catch {
    return false;
  }
}

function hasChanges(): boolean {
  try {
    const status = execSync('git status --porcelain', { encoding: 'utf8' });
    return status.trim().length > 0;
  } catch {
    return false;
  }
}

function gitCommit(prefix: string, issues: number, diagnostics: DiagnosticResult[]): string | null {
  const commandList = diagnostics.map((result) => getDiagnosticName(result.command)).join(', ');
  const message = `${prefix} fix ${issues} issue(s) from ${commandList}`;

  try {
    execSync('git add -A', { stdio: 'pipe' });
    execSync(`git commit -m ${JSON.stringify(message)}`, { stdio: 'pipe' });
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function filterFailingDiagnostics(results: DiagnosticResult[]): DiagnosticResult[] {
  return results.filter((result) => result.issues > 0);
}

export async function healCommand(options: HealOptions): Promise<void> {
  const { config } = loadConfig();
  const commands = getConfiguredCommands(config);

  output.heading('ralph heal');
  output.info('Scanning for issues...');

  const initialResults = await runDiagnostics(commands, {
    only: options.only,
    skip: options.skip,
  });
  const initialSplit = splitDiagnosticResults(initialResults);

  for (const skipped of initialSplit.skipped) {
    output.warn(`Skipping ${skipped.command}: ${skipped.output.trim() || 'command failed to execute'}`);
  }

  const failingDiagnostics = filterFailingDiagnostics(initialSplit.actionable);
  if (failingDiagnostics.length === 0) {
    output.success('All clear — nothing to heal.');
    return;
  }

  printDiagnosticSummary(initialSplit.actionable);

  const validateCommand = composeValidateCommand(
    detectTestCommand(config),
    detectTypecheckCommand(config),
  );
  const prompt = generateHealPrompt(
    {
      diagnostics: failingDiagnostics,
      totalIssues: totalIssues(failingDiagnostics),
      projectName: config.project.name,
    },
    validateCommand,
    process.cwd(),
    new Date().toISOString().slice(0, 10),
  );

  if (options.dryRun === true) {
    output.plain(prompt);
    return;
  }

  const agentConfig = resolveHealAgent(config, options.agent, options.model);
  output.info(`Spawning agent to fix ${totalIssues(failingDiagnostics)} issue(s)...`);

  const result = await spawnAgent(agentConfig, prompt, { verbose: options.verbose });
  if (result.error !== undefined && result.exitCode !== 0) {
    output.error(result.error);
    process.exit(1);
    return;
  }

  if (result.exitCode !== 0) {
    output.warn(`Agent exited with code ${result.exitCode}`);
  } else {
    output.success(`Agent completed in ${formatDuration(result.durationMs)}`);
  }

  const shouldCommit = config.heal!['auto-commit'] && options.noCommit !== true;
  if (shouldCommit) {
    if (!isGitRepo()) {
      output.warn('Not a git repository. Skipping commit.');
    } else if (hasChanges()) {
      const commitHash = gitCommit(
        config.heal!['commit-prefix'],
        totalIssues(failingDiagnostics),
        failingDiagnostics,
      );
      if (commitHash !== null) {
        output.success(`Committed: ${commitHash}`);
      }
    }
  }

  output.info('Verifying fixes...');
  const verificationResults = await runDiagnostics(commands, {
    only: options.only,
    skip: options.skip,
  });
  const verificationSplit = splitDiagnosticResults(verificationResults);

  for (const skipped of verificationSplit.skipped) {
    output.warn(`Skipping ${skipped.command}: ${skipped.output.trim() || 'command failed to execute'}`);
  }

  const remainingIssues = totalIssues(filterFailingDiagnostics(verificationSplit.actionable));
  if (remainingIssues === 0) {
    output.success('All issues resolved!');
  } else {
    output.warn(`${remainingIssues} issue(s) remain after healing. Manual review needed.`);
  }
}
