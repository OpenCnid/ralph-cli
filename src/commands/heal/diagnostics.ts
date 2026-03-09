import { spawn } from 'node:child_process';
import type { DiagnosticResult } from './types.js';

export async function runCommand(cmd: string): Promise<{ output: string; exitCode: number }> {
  return new Promise((resolve) => {
    const [bin, ...args] = cmd.split(' ');
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const chunks: Buffer[] = [];
    proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    proc.stderr.on('data', (chunk: Buffer) => chunks.push(chunk));

    proc.on('close', (code) => {
      resolve({
        output: Buffer.concat(chunks).toString('utf8'),
        exitCode: code ?? 1,
      });
    });

    proc.on('error', (err) => {
      resolve({ output: err.message, exitCode: 1 });
    });
  });
}

export function parseDoctorOutput(output: string): number {
  return output.split('\n').filter((line) => line.startsWith('✗')).length;
}

export function parseGradeOutput(output: string): number {
  return output.split('\n').filter((line) => /Overall grade [DF]/.test(line)).length;
}

export function parseGcOutput(output: string): number {
  return output.split('\n').filter((line) => line.startsWith('⚠')).length;
}

export function parseLintOutput(output: string): number {
  return output.split('\n').filter((line) => line.startsWith('✗') || /violation/i.test(line)).length;
}

function parseIssues(command: string, output: string): number {
  if (command.includes('doctor')) return parseDoctorOutput(output);
  if (command.includes('grade')) return parseGradeOutput(output);
  if (command.includes('gc')) return parseGcOutput(output);
  if (command.includes('lint')) return parseLintOutput(output);
  return 0;
}

export async function runDiagnostics(
  commands: string[],
  options: { only?: string | undefined; skip?: string | undefined },
): Promise<DiagnosticResult[]> {
  const onlyList = options.only ? options.only.split(',').map((s) => s.trim()) : null;
  const skipList = options.skip ? options.skip.split(',').map((s) => s.trim()) : null;

  const effective = commands.filter((cmd) => {
    // Determine the command name (last word of cmd, e.g. "ralph doctor" → "doctor")
    const name = cmd.split(' ').at(-1) ?? cmd;
    if (skipList && skipList.some((s) => name.includes(s) || s.includes(name))) return false;
    if (onlyList && !onlyList.some((o) => name.includes(o) || o.includes(name))) return false;
    return true;
  });

  const results: DiagnosticResult[] = [];
  for (const cmd of effective) {
    const { output, exitCode } = await runCommand(cmd);
    const issues = parseIssues(cmd, output);
    results.push({ command: cmd, issues, output, exitCode });
  }
  return results;
}
