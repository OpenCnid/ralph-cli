import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import type { ScoreResult } from './types.js';
import type { ScoringConfig } from '../../config/schema.js';
import { warn } from '../../utils/output.js';

const SCORE_TIMEOUT_MS = 60_000;

/**
 * Discover the score script path. Returns null if no script found (use default scorer).
 * Throws if config.script is set but the file is missing.
 */
export function discoverScorer(config: ScoringConfig | undefined): string | null {
  if (config?.script != null) {
    if (!existsSync(config.script)) {
      throw new Error(`Scoring script not found: ${config.script}`);
    }
    return config.script;
  }
  if (existsSync('score.sh')) return 'score.sh';
  if (existsSync('score.ts')) return 'score.ts';
  if (existsSync('score.py')) return 'score.py';
  return null;
}

/** Resolve the command + args to execute a score script. */
function resolveRunner(scriptPath: string): { cli: string; args: string[] } {
  if (scriptPath.endsWith('.ts')) return { cli: 'npx', args: ['tsx', scriptPath] };
  if (scriptPath.endsWith('.py')) return { cli: 'python3', args: [scriptPath] };
  return { cli: scriptPath, args: [] };
}

/** Parse the first stdout line into score + metrics. */
function parseOutput(stdout: string, scriptPath: string): ScoreResult {
  const firstLine = stdout.split('\n')[0]?.trim() ?? '';
  if (!firstLine) {
    warn(`Score script produced empty output: ${scriptPath}. Proceeding unscored.`);
    return { score: null, source: 'script', scriptPath, metrics: {}, error: 'empty output' };
  }

  const tabIdx = firstLine.indexOf('\t');
  const scoreStr = tabIdx === -1 ? firstLine : firstLine.slice(0, tabIdx);
  const metricsStr = tabIdx === -1 ? '' : firstLine.slice(tabIdx + 1);

  const score = parseFloat(scoreStr);
  if (isNaN(score)) {
    warn(`Score script returned non-numeric score "${scoreStr}": ${scriptPath}. Proceeding unscored.`);
    return { score: null, source: 'script', scriptPath, metrics: {}, error: `invalid score: ${scoreStr}` };
  }

  if (score < 0.0 || score > 1.0) {
    warn(`Score script returned out-of-range score ${score}: ${scriptPath}. Proceeding unscored.`);
    return { score: null, source: 'script', scriptPath, metrics: {}, error: `score out of range: ${score}` };
  }

  const metrics: Record<string, string> = {};
  if (metricsStr) {
    for (const pair of metricsStr.split(' ')) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx > 0) {
        metrics[pair.slice(0, eqIdx)] = pair.slice(eqIdx + 1);
      }
    }
  }

  return { score, source: 'script', scriptPath, metrics };
}

/**
 * Run a score script and return the result.
 * On EACCES: logs warning, returns result with error='EACCES' and source='default' (caller should run default scorer).
 * On timeout/non-zero exit/bad output: logs warning, returns result with null score.
 */
export function runScorer(scriptPath: string, iteration: number, commit: string): Promise<ScoreResult> {
  return new Promise<ScoreResult>((resolve) => {
    const { cli, args } = resolveRunner(scriptPath);

    const env = { ...process.env, RALPH_ITERATION: String(iteration), RALPH_COMMIT: commit };

    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(cli, args, { env, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EACCES') {
        warn(`Score script is not executable: ${scriptPath}. Falling back to default scorer.`);
        resolve({ score: null, source: 'default', scriptPath: null, metrics: {}, error: 'EACCES' });
      } else {
        resolve({ score: null, source: 'script', scriptPath, metrics: {}, error: (err as Error).message });
      }
      return;
    }

    let settled = false;
    const done = (result: ScoreResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      resolve(result);
    };

    const timeoutHandle = setTimeout(() => {
      proc.kill('SIGKILL');
      warn(`Score script timed out after 60s: ${scriptPath}. Proceeding unscored.`);
      done({ score: null, source: 'script', scriptPath, metrics: {}, error: 'timeout' });
    }, SCORE_TIMEOUT_MS);

    const chunks: Buffer[] = [];
    proc.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));

    proc.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EACCES') {
        warn(`Score script is not executable: ${scriptPath}. Falling back to default scorer.`);
        done({ score: null, source: 'default', scriptPath: null, metrics: {}, error: 'EACCES' });
      } else {
        done({ score: null, source: 'script', scriptPath, metrics: {}, error: err.message });
      }
    });

    proc.on('close', (code: number | null) => {
      if (settled) return;
      if (code !== 0) {
        warn(`Score script exited with code ${code}: ${scriptPath}. Proceeding unscored.`);
        done({ score: null, source: 'script', scriptPath, metrics: {}, error: `exit ${code}` });
        return;
      }

      const stdout = Buffer.concat(chunks).toString('utf-8');
      done(parseOutput(stdout, scriptPath));
    });
  });
}
