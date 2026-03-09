import { spawn } from 'node:child_process';
import type { DiagnosticResult } from './types.js';

const DIAGNOSTIC_NAMES = ['doctor', 'grade', 'gc', 'lint'] as const;

type DiagnosticName = (typeof DIAGNOSTIC_NAMES)[number];

function resolveDiagnosticName(command: string): DiagnosticName | null {
  const tokens = command.split(/\s+/).filter((token) => token.length > 0);
  return (
    DIAGNOSTIC_NAMES.find((name) => tokens.includes(name))
    ?? null
  );
}

async function executeCommand(cmd: string): Promise<{ output: string; exitCode: number }> {
  return new Promise((resolve) => {
    const trimmed = cmd.trim();
    if (trimmed.length === 0) {
      resolve({ output: '', exitCode: 0 });
      return;
    }

    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(trimmed, {
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({ output: (err as Error).message, exitCode: 1 });
      return;
    }

    const chunks: Buffer[] = [];
    proc.stdout?.on('data', (chunk: Buffer | string) =>
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
    );
    proc.stderr?.on('data', (chunk: Buffer | string) =>
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
    );

    proc.on('close', (code: number | null) => {
      resolve({
        output: Buffer.concat(chunks).toString('utf8'),
        exitCode: code ?? 1,
      });
    });

    proc.on('error', (err: NodeJS.ErrnoException) => {
      resolve({ output: err.message, exitCode: 1 });
    });
  });
}

export const diagnosticRuntime = {
  runCommand: executeCommand,
};

export async function runCommand(cmd: string): Promise<{ output: string; exitCode: number }> {
  return executeCommand(cmd);
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
  const diagnosticName = resolveDiagnosticName(command);

  switch (diagnosticName) {
    case 'doctor':
      return parseDoctorOutput(output);
    case 'grade':
      return parseGradeOutput(output);
    case 'gc':
      return parseGcOutput(output);
    case 'lint':
      return parseLintOutput(output);
    default:
      return 0;
  }
}

export async function runDiagnostics(
  commands: string[],
  options: { only?: string | undefined; skip?: string | undefined },
): Promise<DiagnosticResult[]> {
  const onlyList = options.only ? options.only.split(',').map((s) => s.trim()).filter(Boolean) : null;
  const skipList = options.skip ? options.skip.split(',').map((s) => s.trim()).filter(Boolean) : null;

  const effective = commands.filter((cmd) => {
    const name = resolveDiagnosticName(cmd);
    if (name === null) return false;
    if (skipList && skipList.some((skipName) => skipName === name)) return false;
    if (onlyList && !onlyList.some((onlyName) => onlyName === name)) return false;
    return true;
  });

  const results: DiagnosticResult[] = [];
  for (const cmd of effective) {
    const { output, exitCode } = await diagnosticRuntime.runCommand(cmd);
    const issues = parseIssues(cmd, output);
    results.push({ command: cmd, issues, output, exitCode });
  }
  return results;
}
