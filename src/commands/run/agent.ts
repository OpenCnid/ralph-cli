import { spawn } from 'node:child_process';
import type { AgentConfig, RunConfig } from '../../config/schema.js';
import type { AgentResult } from './types.js';

const DEFAULT_TIMEOUT = 1800;

export const AGENT_PRESETS: Record<string, Partial<AgentConfig>> = {
  claude: { args: ['--print', '--dangerously-skip-permissions', '--model', 'sonnet', '--verbose'] },
  codex: { args: ['--model', 'o3', '--approval-mode', 'full-auto', '--quiet'] },
  aider: { args: ['--yes', '--message'] },
};

function formatSpawnError(cli: string, err: unknown): string {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === 'ENOENT') return `Agent CLI "${cli}" not found. Install it and ensure it is in PATH.`;
  if (code === 'EACCES') return `Agent CLI "${cli}" is not executable. Check file permissions.`;
  if (code === 'ENOMEM') return `Agent process ran out of memory.`;
  return `Agent process error: ${(err as Error).message}`;
}

export async function spawnAgent(
  config: AgentConfig,
  prompt: string,
  options?: { verbose?: boolean | undefined },
): Promise<AgentResult> {
  const start = Date.now();
  const controller = new AbortController();
  const { signal } = controller;

  const timeoutHandle = setTimeout(() => controller.abort(), config.timeout * 1000);

  return new Promise<AgentResult>((resolve) => {
    let settled = false;
    const done = (result: AgentResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      resolve(result);
    };

    const verbose = options?.verbose === true;
    const stdioOut: 'inherit' | 'ignore' = verbose ? 'inherit' : 'ignore';

    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(config.cli, config.args, {
        signal,
        stdio: ['pipe', stdioOut, stdioOut],
      });
    } catch (err) {
      done({ exitCode: 1, durationMs: Date.now() - start, error: formatSpawnError(config.cli, err) });
      return;
    }

    proc.stdin?.write(prompt);
    proc.stdin?.end();

    proc.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ABORT_ERR') return;
      done({ exitCode: 1, durationMs: Date.now() - start, error: formatSpawnError(config.cli, err) });
    });

    proc.on('close', (code: number | null) => {
      if (signal.aborted) {
        done({ exitCode: 1, durationMs: Date.now() - start, error: `Agent timed out after ${config.timeout}s` });
      } else {
        done({ exitCode: code ?? 1, durationMs: Date.now() - start });
      }
    });
  });
}

export function injectModel(args: string[], model: string): string[] {
  const result = [...args];
  for (let i = 0; i < result.length; i++) {
    const arg = result[i];
    if (arg === '--model' && i + 1 < result.length) {
      result[i + 1] = model;
      return result;
    }
    if (arg !== undefined && arg.startsWith('--model=')) {
      result[i] = `--model=${model}`;
      return result;
    }
  }
  return [...result, '--model', model];
}

export function resolveAgent(
  mode: 'plan' | 'build',
  runConfig: RunConfig,
  cliAgent?: string | undefined,
  cliModel?: string | undefined,
): AgentConfig {
  // Tier 3: default config
  let base: AgentConfig = runConfig.agent;

  // Tier 2: phase-specific overrides default
  const phaseAgent = mode === 'plan' ? runConfig['plan-agent'] : runConfig['build-agent'];
  if (phaseAgent !== null) {
    base = phaseAgent;
  }

  // Tier 1: CLI flag overrides cli name
  const effectiveCli = cliAgent ?? base.cli;

  // Tier 4: preset — used for args/timeout when CLI changes via --agent flag
  let { args, timeout } = base;
  if (cliAgent !== undefined && cliAgent !== base.cli) {
    const preset = AGENT_PRESETS[effectiveCli] ?? {};
    args = preset.args ?? [];
    timeout = preset.timeout ?? DEFAULT_TIMEOUT;
  }

  // Inject model
  const finalArgs = cliModel !== undefined ? injectModel(args, cliModel) : args;

  return { cli: effectiveCli, args: finalArgs, timeout };
}
