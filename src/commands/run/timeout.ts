import { spawn } from 'node:child_process';
import type { AgentConfig } from '../../config/schema.js';
import { spawnAgent } from './agent.js';
import type { AgentResult } from './types.js';

function formatSpawnError(cli: string, err: unknown): string {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === 'ENOENT') return `Agent CLI "${cli}" not found. Install it and ensure it is in PATH.`;
  if (code === 'EACCES') return `Agent CLI "${cli}" is not executable. Check file permissions.`;
  if (code === 'ENOMEM') return `Agent process ran out of memory.`;
  return `Agent process error: ${(err as Error).message}`;
}

/**
 * Wraps agent spawning with a wall-clock iteration timeout.
 *
 * If iterationTimeout > 0: starts a timer, sends SIGTERM at expiry, waits 10s, sends SIGKILL.
 * Overrides AgentConfig.timeout to Math.max(iterationTimeout + 30, agentConfig.timeout) to
 * prevent the inner spawnAgent() abort from racing the outer SIGTERM/SIGKILL sequence.
 *
 * If iterationTimeout === 0: passes through to spawnAgent() unchanged (no wall-clock limit).
 *
 * Returns AgentResult with timedOut: true when the iteration timeout fires.
 */
export async function spawnAgentWithTimeout(
  config: AgentConfig,
  prompt: string,
  iterationTimeout: number,
  options?: { verbose?: boolean | undefined; capture?: boolean | undefined },
): Promise<AgentResult> {
  if (iterationTimeout === 0) {
    return spawnAgent(config, prompt, options);
  }

  // Override inner timeout to prevent it from firing before outer SIGTERM/SIGKILL
  const effectiveConfig: AgentConfig = {
    ...config,
    timeout: Math.max(iterationTimeout + 30, config.timeout),
  };

  const start = Date.now();
  const controller = new AbortController();
  const { signal } = controller;

  const innerTimeoutHandle = setTimeout(() => controller.abort(), effectiveConfig.timeout * 1000);

  return new Promise<AgentResult>((resolve) => {
    let settled = false;
    let timedOut = false;
    let outerTimeoutHandle: NodeJS.Timeout | undefined;
    let killHandle: NodeJS.Timeout | undefined;

    const done = (result: AgentResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(innerTimeoutHandle);
      clearTimeout(outerTimeoutHandle);
      clearTimeout(killHandle);
      resolve(result);
    };

    const verbose = options?.verbose === true;
    const capture = options?.capture === true;
    const stdioOut: 'pipe' | 'inherit' | 'ignore' = capture ? 'pipe' : verbose ? 'inherit' : 'ignore';

    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(effectiveConfig.cli, effectiveConfig.args, {
        signal,
        stdio: ['pipe', stdioOut, verbose ? 'inherit' : 'ignore'],
      });
    } catch (err) {
      done({ exitCode: 1, durationMs: Date.now() - start, error: formatSpawnError(effectiveConfig.cli, err) });
      return;
    }

    proc.stdin?.write(prompt);
    proc.stdin?.end();

    const chunks: Buffer[] = [];
    if (capture) {
      proc.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
    }

    // Outer wall-clock timer: SIGTERM at iterationTimeout, SIGKILL 10s later
    outerTimeoutHandle = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      try {
        proc.kill('SIGTERM');
      } catch {
        // process may have already exited
      }
      killHandle = setTimeout(() => {
        if (settled) return;
        try {
          proc.kill('SIGKILL');
        } catch {
          // process may have already exited
        }
      }, 10_000);
    }, iterationTimeout * 1000);

    proc.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ABORT_ERR') return;
      done({ exitCode: 1, durationMs: Date.now() - start, error: formatSpawnError(effectiveConfig.cli, err) });
    });

    proc.on('close', (code: number | null) => {
      const output = capture ? Buffer.concat(chunks).toString('utf-8') : undefined;
      if (timedOut) {
        done({ exitCode: 1, durationMs: Date.now() - start, timedOut: true, output });
      } else if (signal.aborted) {
        done({ exitCode: 1, durationMs: Date.now() - start, error: `Agent timed out after ${effectiveConfig.timeout}s`, output });
      } else {
        done({ exitCode: code ?? 1, durationMs: Date.now() - start, output });
      }
    });
  });
}
