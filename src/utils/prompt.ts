import { createInterface } from 'node:readline/promises';
import type { Readable, Writable } from 'node:stream';

interface PromptIoOptions {
  input?: Readable | undefined;
  output?: Writable | undefined;
}

function isInteractive(): boolean {
  return process.stdin.isTTY === true;
}

function resolveDefaultIndex(options: string[], defaultIdx: number | undefined): number {
  if (options.length === 0) {
    throw new Error('select() requires at least one option');
  }
  if (defaultIdx === undefined || Number.isNaN(defaultIdx)) return 0;
  if (defaultIdx < 0) return 0;
  if (defaultIdx >= options.length) return options.length - 1;
  return defaultIdx;
}

export async function ask(
  question: string,
  defaultValue?: string,
  io: PromptIoOptions = {},
): Promise<string> {
  if (!isInteractive()) return defaultValue ?? '';

  const input = io.input ?? process.stdin;
  const output = io.output ?? process.stdout;
  const rl = createInterface({ input, output });
  const suffix = defaultValue !== undefined ? ` (${defaultValue})` : '';

  try {
    const answer = await rl.question(`? ${question}${suffix}: `);
    return answer.trim() === '' ? (defaultValue ?? '') : answer;
  } finally {
    rl.close();
  }
}

export async function confirm(
  question: string,
  defaultYes?: boolean,
  io: PromptIoOptions = {},
): Promise<boolean> {
  if (!isInteractive()) return defaultYes ?? false;

  const input = io.input ?? process.stdin;
  const output = io.output ?? process.stdout;
  const rl = createInterface({ input, output });
  const suffix = defaultYes === undefined
    ? ' (y/n)'
    : defaultYes ? ' (Y/n)' : ' (y/N)';

  try {
    const answer = (await rl.question(`? ${question}${suffix}: `)).trim().toLowerCase();
    if (answer === 'y' || answer === 'yes') return true;
    if (answer === 'n' || answer === 'no') return false;
    return defaultYes ?? false;
  } finally {
    rl.close();
  }
}

export async function select(
  question: string,
  options: string[],
  defaultIdx?: number,
  io: PromptIoOptions = {},
): Promise<string> {
  const resolvedDefaultIdx = resolveDefaultIndex(options, defaultIdx);
  const defaultOption = options[resolvedDefaultIdx]!;
  if (!isInteractive()) return defaultOption;

  const input = io.input ?? process.stdin;
  const output = io.output ?? process.stdout;
  const rl = createInterface({ input, output });

  try {
    output.write(`? ${question}\n`);
    for (let i = 0; i < options.length; i++) {
      const pointer = i === resolvedDefaultIdx ? '  ▸' : '   ';
      output.write(`${pointer} ${i + 1}. ${options[i]}\n`);
    }
    const answer = (await rl.question(`  [${resolvedDefaultIdx + 1}]: `)).trim();
    if (answer === '') return defaultOption;
    const idx = Number.parseInt(answer, 10) - 1;
    if (Number.isNaN(idx) || idx < 0 || idx >= options.length) return defaultOption;
    return options[idx]!;
  } finally {
    rl.close();
  }
}
