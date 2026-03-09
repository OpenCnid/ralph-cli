import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const runCommandMock = vi.fn().mockResolvedValue(undefined);

vi.mock('./index.js', () => ({
  runCommand: runCommandMock,
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride(); // prevent process.exit in tests

  program
    .command('run [mode]')
    .description('Run an AI agent loop (mode: plan or build, default: build)')
    .option('--max <n>', 'Override max iterations', (v: string) => parseInt(v, 10))
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
      await runCommandMock(resolvedMode, {
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

  return program;
}

async function parse(args: string[]): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(['node', 'ralph', ...args]);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ralph run CLI parsing', () => {
  beforeEach(() => {
    runCommandMock.mockClear();
  });

  it('defaults mode to build', async () => {
    await parse(['run']);
    expect(runCommandMock).toHaveBeenCalledWith('build', expect.objectContaining({}));
  });

  it('accepts plan mode', async () => {
    await parse(['run', 'plan']);
    expect(runCommandMock).toHaveBeenCalledWith('plan', expect.objectContaining({}));
  });

  it('accepts build mode', async () => {
    await parse(['run', 'build']);
    expect(runCommandMock).toHaveBeenCalledWith('build', expect.objectContaining({}));
  });

  it('parses --max as integer', async () => {
    await parse(['run', '--max', '5']);
    expect(runCommandMock).toHaveBeenCalledWith('build', expect.objectContaining({ max: 5 }));
  });

  it('parses --agent', async () => {
    await parse(['run', '--agent', 'claude']);
    expect(runCommandMock).toHaveBeenCalledWith('build', expect.objectContaining({ agent: 'claude' }));
  });

  it('parses --model', async () => {
    await parse(['run', '--model', 'claude-opus-4-6']);
    expect(runCommandMock).toHaveBeenCalledWith('build', expect.objectContaining({ model: 'claude-opus-4-6' }));
  });

  it('parses --dry-run', async () => {
    await parse(['run', '--dry-run']);
    expect(runCommandMock).toHaveBeenCalledWith('build', expect.objectContaining({ dryRun: true }));
  });

  it('parses --no-commit as noCommit: true', async () => {
    await parse(['run', '--no-commit']);
    expect(runCommandMock).toHaveBeenCalledWith('build', expect.objectContaining({ noCommit: true }));
  });

  it('parses --no-push as noPush: true', async () => {
    await parse(['run', '--no-push']);
    expect(runCommandMock).toHaveBeenCalledWith('build', expect.objectContaining({ noPush: true }));
  });

  it('parses --resume', async () => {
    await parse(['run', '--resume']);
    expect(runCommandMock).toHaveBeenCalledWith('build', expect.objectContaining({ resume: true }));
  });

  it('parses --verbose', async () => {
    await parse(['run', '--verbose']);
    expect(runCommandMock).toHaveBeenCalledWith('build', expect.objectContaining({ verbose: true }));
  });

  it('parses all options together', async () => {
    await parse(['run', 'plan', '--max', '3', '--agent', 'aider', '--model', 'claude-haiku-4-5-20251001',
      '--dry-run', '--no-commit', '--no-push', '--resume', '--verbose']);
    expect(runCommandMock).toHaveBeenCalledWith('plan', {
      max: 3,
      agent: 'aider',
      model: 'claude-haiku-4-5-20251001',
      dryRun: true,
      noCommit: true,
      noPush: true,
      resume: true,
      verbose: true,
    });
  });

  it('shows help text with --help', () => {
    const program = buildProgram();
    const runCmd = program.commands.find((c) => c.name() === 'run');
    expect(runCmd).toBeDefined();
    const helpText = runCmd!.helpInformation();
    expect(helpText).toContain('--max');
    expect(helpText).toContain('--agent');
    expect(helpText).toContain('--model');
    expect(helpText).toContain('--dry-run');
    expect(helpText).toContain('--no-commit');
    expect(helpText).toContain('--no-push');
    expect(helpText).toContain('--resume');
    expect(helpText).toContain('--verbose');
  });
});
