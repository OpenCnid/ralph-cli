import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

const scoreCommandMock = vi.fn().mockResolvedValue(undefined);

vi.mock('./index.js', () => ({
  scoreCommand: scoreCommandMock,
}));

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();

  program
    .command('score')
    .description('Run fitness scorer and view score history')
    .option('--history [n]', 'Show last N results from results.tsv (default: 20)')
    .option('--trend [n]', 'Show ASCII sparkline of last N scores (default: 20)')
    .option('--compare', 'Compare current score vs last recorded')
    .option('--json', 'Output current score as JSON')
    .action(async (options: { history?: string | boolean; trend?: string | boolean; compare?: boolean; json?: boolean }) => {
      const parseN = (val: string | boolean | undefined): number | boolean | undefined => {
        if (val === undefined || val === false) return undefined;
        if (val === true || val === '') return true;
        const n = parseInt(val as string, 10);
        return isNaN(n) ? true : n;
      };
      const h = parseN(options.history);
      const t = parseN(options.trend);
      await scoreCommandMock({
        ...(h !== undefined ? { history: h } : {}),
        ...(t !== undefined ? { trend: t } : {}),
        compare: options.compare,
        json: options.json,
      });
    });

  return program;
}

async function parse(args: string[]): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(['node', 'ralph', ...args]);
}

describe('ralph score CLI parsing', () => {
  beforeEach(() => {
    scoreCommandMock.mockClear();
  });

  it('invokes scoreCommand with empty options when no flags', async () => {
    await parse(['score']);
    expect(scoreCommandMock).toHaveBeenCalledWith({});
  });

  it('parses --history without value (default)', async () => {
    await parse(['score', '--history']);
    expect(scoreCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({ history: true })
    );
  });

  it('parses --history with numeric value', async () => {
    await parse(['score', '--history', '10']);
    expect(scoreCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({ history: 10 })
    );
  });

  it('parses --trend without value (default)', async () => {
    await parse(['score', '--trend']);
    expect(scoreCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({ trend: true })
    );
  });

  it('parses --trend with numeric value', async () => {
    await parse(['score', '--trend', '5']);
    expect(scoreCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({ trend: 5 })
    );
  });

  it('parses --compare', async () => {
    await parse(['score', '--compare']);
    expect(scoreCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({ compare: true })
    );
  });

  it('parses --json', async () => {
    await parse(['score', '--json']);
    expect(scoreCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({ json: true })
    );
  });

  it('combines --history and other flags', async () => {
    await parse(['score', '--history', '20', '--json']);
    expect(scoreCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({ history: 20, json: true })
    );
  });
});
