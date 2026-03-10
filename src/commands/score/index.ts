import { execSync } from 'node:child_process';
import { loadConfig, type LoadResult } from '../../config/loader.js';
import { discoverScorer, runScorer } from './scorer.js';
import { runDefaultScorer } from './default-scorer.js';
import { readResults } from './results.js';
import { computeTrend, renderSparkline } from './trend.js';
import * as output from '../../utils/output.js';
import type { ScoreResult } from './types.js';
import type { RalphConfig } from '../../config/schema.js';

export interface ScoreOptions {
  history?: number | boolean | undefined;
  trend?: number | boolean | undefined;
  compare?: boolean | undefined;
  json?: boolean | undefined;
}

function getCommit(): string {
  try {
    return execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

function runDefaultScorerStandalone(config: RalphConfig): ScoreResult {
  const testCmd = config.run?.validation['test-command'];
  let testStdout = '';
  if (testCmd != null && testCmd !== '') {
    try {
      testStdout = execSync(testCmd, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err: unknown) {
      testStdout = (err as { stdout?: string }).stdout ?? '';
    }
  }
  return runDefaultScorer(testStdout, config);
}

async function runCurrentScorer(config: RalphConfig): Promise<ScoreResult> {
  process.env['RALPH_ITERATION'] = '0';
  const commit = getCommit();

  let scriptPath: string | null;
  try {
    scriptPath = discoverScorer(config.scoring);
  } catch (err) {
    return {
      score: null,
      source: 'script',
      scriptPath: null,
      metrics: {},
      error: (err as Error).message,
    };
  }

  if (scriptPath !== null) {
    const result = await runScorer(scriptPath, 0, commit);
    // EACCES fallback: runScorer returns source='default' when fallback needed
    if (result.source === 'default') {
      return runDefaultScorerStandalone(config);
    }
    return result;
  }

  return runDefaultScorerStandalone(config);
}

function formatSourceLabel(result: ScoreResult, config: RalphConfig): string {
  if (result.source === 'script' && result.scriptPath !== null) {
    return `custom: ${result.scriptPath}`;
  }
  const weights = config.scoring?.['default-weights'] ?? { tests: 0.6, coverage: 0.4 };
  return `default: tests=${weights.tests} coverage=${weights.coverage}`;
}

function formatMetrics(result: ScoreResult): string[] {
  const lines: string[] = [];
  const m = result.metrics;

  if (result.source === 'default') {
    if ('test_rate' in m) {
      const rate = parseFloat(m['test_rate'] ?? '0').toFixed(3);
      const count = m['test_count'] ?? '0';
      const total = m['test_total'] ?? '0';
      lines.push(`  test_rate:   ${rate} (${count}/${total})`);
    }
    if ('coverage' in m) {
      const pct = (parseFloat(m['coverage'] ?? '0') * 100).toFixed(1);
      lines.push(`  coverage:    ${pct}%`);
    }
  } else {
    for (const [k, v] of Object.entries(m)) {
      lines.push(`  ${k}:   ${v}`);
    }
  }

  return lines;
}

function formatDelta(delta: number): string {
  return delta >= 0 ? `+${delta.toFixed(3)}` : delta.toFixed(3);
}

function printHistory(limit: number): void {
  const entries = readResults(limit);
  if (entries.length === 0) {
    output.plain('No results recorded yet.');
    return;
  }
  output.plain(`Last ${entries.length} result(s):`);
  output.plain('');
  output.plain('Commit   Iter  Status   Score   Delta    Dur(s)  Metrics');
  output.plain('-------  ----  -------  ------  -------  ------  -------');
  for (const e of entries) {
    const score = e.score !== null ? e.score.toFixed(3) : '  —  ';
    const delta = e.delta !== null ? formatDelta(e.delta) : '   —  ';
    const metrics = e.metrics !== '—' ? e.metrics : '';
    const commit = e.commit.padEnd(7).slice(0, 7);
    const iter = String(e.iteration).padStart(4);
    const status = e.status.padEnd(7);
    const dur = String(e.durationS).padStart(6);
    output.plain(`${commit}  ${iter}  ${status}  ${score}  ${delta}  ${dur}  ${metrics}`);
  }
}

function printTrend(limit: number): void {
  const entries = readResults(limit);
  const trend = computeTrend(entries, limit);
  if (trend === null) {
    output.plain('No scored results recorded yet.');
    return;
  }

  const scores = entries.slice(-limit).map(e => e.score);
  const sparkline = renderSparkline(scores);
  const delta = trend.last - trend.first;
  const deltaStr = formatDelta(delta);

  output.plain(`Score trend (last ${Math.min(entries.length, limit)} iterations):`);
  output.plain(`  ${sparkline}  ${trend.first.toFixed(2)} → ${trend.last.toFixed(2)} (${deltaStr})`);
  output.plain(`  Best: ${trend.max.toFixed(2)} (iteration ${trend.bestIteration})  Worst: ${trend.min.toFixed(2)} (iteration ${trend.worstIteration})`);
}

async function runCompare(config: RalphConfig): Promise<void> {
  const entries = readResults(1);
  const lastEntry = entries.length > 0 ? entries[entries.length - 1] : null;
  const result = await runCurrentScorer(config);

  if (result.score === null) {
    output.error(`Scoring failed${result.error ? `: ${result.error}` : ''}`);
    process.exit(1);
  }

  if (lastEntry == null || lastEntry.score === null) {
    output.plain(`Current: ${result.score.toFixed(3)}    Last recorded: —    Delta: —`);
    return;
  }

  const delta = result.score - lastEntry.score;
  const deltaStr = formatDelta(delta);
  const threshold = config.scoring?.['regression-threshold'] ?? 0.02;

  if (delta < -threshold) {
    output.plain(
      `Current: ${result.score.toFixed(3)}    Last recorded: ${lastEntry.score.toFixed(3)}    Delta: ${deltaStr} ✗ (exceeds threshold ${threshold})`
    );
  } else {
    output.plain(
      `Current: ${result.score.toFixed(3)}    Last recorded: ${lastEntry.score.toFixed(3)}    Delta: ${deltaStr} ✓`
    );
  }
}

export async function scoreCommand(options: ScoreOptions): Promise<void> {
  if (options.history !== undefined && options.history !== false) {
    const limit = typeof options.history === 'number' ? options.history : 20;
    printHistory(limit);
    return;
  }

  if (options.trend !== undefined && options.trend !== false) {
    const limit = typeof options.trend === 'number' ? options.trend : 20;
    printTrend(limit);
    return;
  }

  let loadResult: LoadResult;
  try {
    loadResult = loadConfig();
  } catch (err) {
    output.error(`Failed to load config: ${(err as Error).message}`);
    process.exit(1);
  }
  const config: RalphConfig = loadResult.config;

  if (options.compare === true) {
    await runCompare(config);
    return;
  }

  const result = await runCurrentScorer(config);

  if (result.score === null) {
    output.error(`Scoring failed${result.error ? `: ${result.error}` : ''}`);
    process.exit(1);
  }

  if (options.json === true) {
    const jsonOut = {
      score: result.score,
      source: result.scriptPath ?? 'default',
      metrics: result.metrics,
      timestamp: new Date().toISOString(),
    };
    console.log(JSON.stringify(jsonOut, null, 2));
    return;
  }

  const label = formatSourceLabel(result, config);
  output.plain(`Score: ${result.score.toFixed(3)} (${label})`);
  for (const line of formatMetrics(result)) {
    output.plain(line);
  }
}
