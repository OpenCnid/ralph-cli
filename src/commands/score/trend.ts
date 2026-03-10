import type { ResultEntry } from './types.js';

const SPARKLINE_CHARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;
const FLAT_CHAR = '▅';

export interface TrendResult {
  min: number;
  max: number;
  bestIteration: number;
  worstIteration: number;
  first: number;
  last: number;
}

/**
 * Render an ASCII sparkline for a sequence of scores.
 * Null entries are skipped (not rendered).
 * When all scores are equal (min === max), uses '▅' for all.
 */
export function renderSparkline(scores: (number | null)[]): string {
  const valid = scores.filter((s): s is number => s !== null);
  if (valid.length === 0) return '';

  const min = Math.min(...valid);
  const max = Math.max(...valid);

  return scores
    .filter((s): s is number => s !== null)
    .map(score => {
      if (min === max) return FLAT_CHAR;
      const index = Math.min(7, Math.floor(((score - min) / (max - min)) * 7));
      return SPARKLINE_CHARS[index];
    })
    .join('');
}

/**
 * Compute trend statistics for the last `n` entries.
 * Only entries with non-null scores are considered.
 */
export function computeTrend(entries: ResultEntry[], n: number): TrendResult | null {
  const window = entries.slice(-n);
  const scored = window.filter(e => e.score !== null);
  if (scored.length === 0) return null;

  let min = Infinity;
  let max = -Infinity;
  let bestIteration = scored[0]!.iteration;
  let worstIteration = scored[0]!.iteration;

  for (const entry of scored) {
    const score = entry.score as number;
    if (score < min) {
      min = score;
      worstIteration = entry.iteration;
    }
    if (score > max) {
      max = score;
      bestIteration = entry.iteration;
    }
  }

  return {
    min,
    max,
    bestIteration,
    worstIteration,
    first: scored[0]!.score as number,
    last: scored[scored.length - 1]!.score as number,
  };
}
