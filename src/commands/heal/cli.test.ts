import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

const healCommandMock = vi.fn().mockResolvedValue(undefined);

vi.mock('./index.js', () => ({
  healCommand: healCommandMock,
}));

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();

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
      await healCommandMock({
        agent: options.agent,
        model: options.model,
        only: options.only,
        skip: options.skip,
        dryRun: options.dryRun,
        noCommit: options.commit === false ? true : undefined,
        verbose: options.verbose,
      });
    });

  return program;
}

async function parse(args: string[]): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(['node', 'ralph', ...args]);
}

describe('ralph heal CLI parsing', () => {
  beforeEach(() => {
    healCommandMock.mockClear();
  });

  it('invokes healCommand with default options', async () => {
    await parse(['heal']);
    expect(healCommandMock).toHaveBeenCalledWith({});
  });

  it('parses --agent', async () => {
    await parse(['heal', '--agent', 'codex']);
    expect(healCommandMock).toHaveBeenCalledWith(expect.objectContaining({ agent: 'codex' }));
  });

  it('parses --model', async () => {
    await parse(['heal', '--model', 'o4-mini']);
    expect(healCommandMock).toHaveBeenCalledWith(expect.objectContaining({ model: 'o4-mini' }));
  });

  it('parses --only', async () => {
    await parse(['heal', '--only', 'doctor,gc']);
    expect(healCommandMock).toHaveBeenCalledWith(expect.objectContaining({ only: 'doctor,gc' }));
  });

  it('parses --skip', async () => {
    await parse(['heal', '--skip', 'grade']);
    expect(healCommandMock).toHaveBeenCalledWith(expect.objectContaining({ skip: 'grade' }));
  });

  it('parses --dry-run', async () => {
    await parse(['heal', '--dry-run']);
    expect(healCommandMock).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
  });

  it('parses --no-commit as noCommit: true', async () => {
    await parse(['heal', '--no-commit']);
    expect(healCommandMock).toHaveBeenCalledWith(expect.objectContaining({ noCommit: true }));
  });

  it('parses --verbose', async () => {
    await parse(['heal', '--verbose']);
    expect(healCommandMock).toHaveBeenCalledWith(expect.objectContaining({ verbose: true }));
  });

  it('parses all options together', async () => {
    await parse([
      'heal',
      '--agent',
      'aider',
      '--model',
      'o4-mini',
      '--only',
      'doctor,gc',
      '--skip',
      'grade',
      '--dry-run',
      '--no-commit',
      '--verbose',
    ]);

    expect(healCommandMock).toHaveBeenCalledWith({
      agent: 'aider',
      model: 'o4-mini',
      only: 'doctor,gc',
      skip: 'grade',
      dryRun: true,
      noCommit: true,
      verbose: true,
    });
  });

  it('shows help text with --help', () => {
    const program = buildProgram();
    const healCmd = program.commands.find((command) => command.name() === 'heal');

    expect(healCmd).toBeDefined();
    const helpText = healCmd!.helpInformation();
    expect(helpText).toContain('--agent');
    expect(helpText).toContain('--model');
    expect(helpText).toContain('--only');
    expect(helpText).toContain('--skip');
    expect(helpText).toContain('--dry-run');
    expect(helpText).toContain('--no-commit');
    expect(helpText).toContain('--verbose');
  });
});
