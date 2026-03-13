import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import type { ResultEntry } from './types.js';

const RESULTS_FILE = '.ralph/results.tsv';
const RALPH_DIR = '.ralph';
const HEADER = 'commit\titeration\tstatus\tscore\tdelta\tduration_s\tmetrics\tdescription\tstages';

/** Sanitize a value for TSV: replace tabs with spaces. */
function sanitizeValue(value: string): string {
  return value.replace(/\t/g, ' ');
}

/** Sanitize the metrics string: replace control chars, cap at 200 chars. */
function sanitizeMetrics(metrics: string): string {
  // Replace control characters (except space) with spaces
  // eslint-disable-next-line no-control-regex
  const sanitized = metrics.replace(/[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]/g, ' ');
  if (sanitized.length > 200) {
    return sanitized.slice(0, 199) + '…';
  }
  return sanitized;
}

/** Append one ResultEntry row to .ralph/results.tsv, creating it with a header if absent. */
export function appendResult(entry: ResultEntry): void {
  if (!existsSync(RESULTS_FILE)) {
    if (!existsSync(RALPH_DIR)) {
      mkdirSync(RALPH_DIR, { recursive: true });
    }
    appendFileSync(RESULTS_FILE, HEADER + '\n', 'utf8');
  }

  const score = entry.score === null ? '—' : String(entry.score);
  const delta = entry.delta === null ? '—' : String(entry.delta);
  const metrics = sanitizeMetrics(sanitizeValue(entry.metrics));
  const description = sanitizeValue(entry.description);

  const row = [
    sanitizeValue(entry.commit),
    String(entry.iteration),
    entry.status,
    score,
    delta,
    String(entry.durationS),
    metrics,
    description,
    entry.stages ?? '—',
  ].join('\t');

  appendFileSync(RESULTS_FILE, row + '\n', 'utf8');
}

/** Read the last `limit` result entries from .ralph/results.tsv. */
export function readResults(limit?: number): ResultEntry[] {
  if (!existsSync(RESULTS_FILE)) {
    return [];
  }

  let raw: string;
  try {
    raw = readFileSync(RESULTS_FILE, 'utf8');
  } catch {
    return [];
  }

  const lines = raw.split('\n').filter(line => line.trim() !== '');
  // Skip header row
  const dataLines = lines.slice(1);

  const rows = limit !== undefined ? dataLines.slice(-limit) : dataLines;

  return rows.map(line => {
    const cols = line.split('\t');
    const [commit, iterStr, status, scoreStr, deltaStr, durationStr, metrics, description, stages] = cols;

    return {
      commit: commit ?? '',
      iteration: parseInt(iterStr ?? '0', 10),
      status: (status ?? 'pass') as ResultEntry['status'],
      score: scoreStr === '—' || scoreStr === undefined ? null : parseFloat(scoreStr),
      delta: deltaStr === '—' || deltaStr === undefined ? null : parseFloat(deltaStr),
      durationS: parseInt(durationStr ?? '0', 10),
      metrics: metrics ?? '—',
      description: description ?? '—',
      stages: stages && stages !== '—' ? stages : undefined,
    };
  });
}
