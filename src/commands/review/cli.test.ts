import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const reviewCommandMock = vi.fn().mockResolvedValue(undefined);

vi.mock('./index.js', () => ({
  reviewCommand: reviewCommandMock,
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride(); // prevent process.exit in tests

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
    .option('--intent', 'Evaluate implementation against spec motivations instead of requirements')
    .action(async (target: string | undefined, options: {
      scope?: string;
      agent?: string;
      model?: string;
      format?: string;
      output?: string;
      dryRun?: boolean;
      verbose?: boolean;
      diffOnly?: boolean;
      intent?: boolean;
    }) => {
      await reviewCommandMock(target, options);
    });

  return program;
}

async function parse(args: string[]): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(['node', 'ralph', ...args]);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ralph review CLI parsing', () => {
  beforeEach(() => {
    reviewCommandMock.mockClear();
  });

  it('defaults target to undefined', async () => {
    await parse(['review']);
    expect(reviewCommandMock).toHaveBeenCalledWith(undefined, expect.objectContaining({}));
  });

  it('accepts a target argument (commit SHA)', async () => {
    await parse(['review', 'HEAD']);
    expect(reviewCommandMock).toHaveBeenCalledWith('HEAD', expect.objectContaining({}));
  });

  it('accepts a range target', async () => {
    await parse(['review', 'main..HEAD']);
    expect(reviewCommandMock).toHaveBeenCalledWith('main..HEAD', expect.objectContaining({}));
  });

  it('parses --scope', async () => {
    await parse(['review', '--scope', 'working']);
    expect(reviewCommandMock).toHaveBeenCalledWith(undefined, expect.objectContaining({ scope: 'working' }));
  });

  it('parses --agent', async () => {
    await parse(['review', '--agent', 'claude']);
    expect(reviewCommandMock).toHaveBeenCalledWith(undefined, expect.objectContaining({ agent: 'claude' }));
  });

  it('parses --model', async () => {
    await parse(['review', '--model', 'claude-opus-4-6']);
    expect(reviewCommandMock).toHaveBeenCalledWith(undefined, expect.objectContaining({ model: 'claude-opus-4-6' }));
  });

  it('parses --format', async () => {
    await parse(['review', '--format', 'json']);
    expect(reviewCommandMock).toHaveBeenCalledWith(undefined, expect.objectContaining({ format: 'json' }));
  });

  it('parses --output', async () => {
    await parse(['review', '--output', 'review.md']);
    expect(reviewCommandMock).toHaveBeenCalledWith(undefined, expect.objectContaining({ output: 'review.md' }));
  });

  it('parses --dry-run', async () => {
    await parse(['review', '--dry-run']);
    expect(reviewCommandMock).toHaveBeenCalledWith(undefined, expect.objectContaining({ dryRun: true }));
  });

  it('parses --verbose', async () => {
    await parse(['review', '--verbose']);
    expect(reviewCommandMock).toHaveBeenCalledWith(undefined, expect.objectContaining({ verbose: true }));
  });

  it('parses --diff-only', async () => {
    await parse(['review', '--diff-only']);
    expect(reviewCommandMock).toHaveBeenCalledWith(undefined, expect.objectContaining({ diffOnly: true }));
  });

  it('parses all options together', async () => {
    await parse(['review', 'HEAD~1', '--scope', 'commit', '--agent', 'aider',
      '--model', 'claude-haiku-4-5-20251001', '--format', 'markdown',
      '--output', 'out.md', '--dry-run', '--verbose', '--diff-only']);
    expect(reviewCommandMock).toHaveBeenCalledWith('HEAD~1', {
      scope: 'commit',
      agent: 'aider',
      model: 'claude-haiku-4-5-20251001',
      format: 'markdown',
      output: 'out.md',
      dryRun: true,
      verbose: true,
      diffOnly: true,
    });
  });

  it('parses --intent', async () => {
    await parse(['review', '--intent']);
    expect(reviewCommandMock).toHaveBeenCalledWith(undefined, expect.objectContaining({ intent: true }));
  });

  it('parses --intent combined with --dry-run --diff-only', async () => {
    await parse(['review', '--intent', '--dry-run', '--diff-only']);
    expect(reviewCommandMock).toHaveBeenCalledWith(undefined, expect.objectContaining({
      intent: true,
      dryRun: true,
      diffOnly: true,
    }));
  });

  it('shows help text with all options', () => {
    const program = buildProgram();
    const reviewCmd = program.commands.find((c) => c.name() === 'review');
    expect(reviewCmd).toBeDefined();
    const helpText = reviewCmd!.helpInformation();
    expect(helpText).toContain('--scope');
    expect(helpText).toContain('--agent');
    expect(helpText).toContain('--model');
    expect(helpText).toContain('--format');
    expect(helpText).toContain('--output');
    expect(helpText).toContain('--dry-run');
    expect(helpText).toContain('--verbose');
    expect(helpText).toContain('--diff-only');
  });
});
