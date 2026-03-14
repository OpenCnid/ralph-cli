import { appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { safeReadFile, ensureDir } from '../../utils/fs.js';
import * as output from '../../utils/output.js';
import type { DivergenceConfig } from '../../config/schema.js';
import type { PatternData } from './scanners.js';

// F-AD02: Pattern Snapshot Computation

export interface PatternFingerprint {
  iteration: number;
  commit: string;
  timestamp: string; // ISO 8601
  patterns: Record<string, Record<string, number>>; // category → variant → file count
}

export function computeFingerprint(
  patternData: PatternData,
  iteration: number,
  commit: string,
): PatternFingerprint {
  const patterns: Record<string, Record<string, number>> = {};
  for (const [category, variants] of Object.entries(patternData)) {
    const categoryRecord: Record<string, number> = {};
    for (const [variant, entry] of variants.entries()) {
      categoryRecord[variant] = entry.files.length;
    }
    patterns[category] = categoryRecord;
  }
  return {
    iteration,
    commit,
    timestamp: new Date().toISOString(),
    patterns,
  };
}

// F-AD03: Pattern History Storage

export function appendPatternHistory(projectRoot: string, entry: PatternFingerprint): void {
  const path = join(projectRoot, '.ralph', 'pattern-history.jsonl');
  try {
    ensureDir(dirname(path));
    appendFileSync(path, JSON.stringify(entry) + '\n');
  } catch (err) {
    output.warn(`Failed to append pattern history: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function loadPatternHistory(projectRoot: string): PatternFingerprint[] {
  const path = join(projectRoot, '.ralph', 'pattern-history.jsonl');
  const content = safeReadFile(path);
  if (!content) return [];
  const results: PatternFingerprint[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      results.push(JSON.parse(trimmed) as PatternFingerprint);
    } catch { /* skip malformed lines */ }
  }
  return results;
}

// F-AD04: Divergence Detection

export interface DivergenceItem {
  category: string;
  type: 'new-pattern' | 'dominant-shift' | 'proportion-change';
  variant: string;
  detail: string;
}

function findDominant(variants: Record<string, number>): string | null {
  let dominant: string | null = null;
  let maxCount = -1;
  for (const [variant, count] of Object.entries(variants)) {
    if (count > maxCount || (count === maxCount && dominant !== null && variant < dominant)) {
      dominant = variant;
      maxCount = count;
    }
  }
  return dominant;
}

export function detectDivergence(
  current: PatternFingerprint,
  previous: PatternFingerprint | null | undefined,
  config: DivergenceConfig,
): DivergenceItem[] {
  if (!previous) return [];

  const items: DivergenceItem[] = [];
  const newPatternThreshold = config['new-pattern-threshold'];
  const proportionThreshold = config['proportion-change-threshold'];

  for (const [category, currentVariants] of Object.entries(current.patterns)) {
    const previousVariants = previous.patterns[category] ?? null;

    const currentTotal = Object.values(currentVariants).reduce((a, b) => a + b, 0);
    const previousTotal = previousVariants
      ? Object.values(previousVariants).reduce((a, b) => a + b, 0)
      : 0;

    // new-pattern: variant count > 0 in current AND absent/0 in previous AND count >= threshold
    for (const [variant, count] of Object.entries(currentVariants)) {
      if (count > 0) {
        const prevCount = previousVariants ? (previousVariants[variant] ?? 0) : 0;
        if (prevCount === 0 && count >= newPatternThreshold) {
          const detail = previousVariants
            ? `"${variant}" appeared for the first time (${count} ${count === 1 ? 'file' : 'files'})`
            : `New category with variant "${variant}" (${count} ${count === 1 ? 'file' : 'files'})`;
          items.push({ category, type: 'new-pattern', variant, detail });
        }
      }
    }

    // dominant-shift: highest-count variant changed (alphabetical tiebreak)
    const currentDominant = findDominant(currentVariants);
    const previousDominant = previousVariants ? findDominant(previousVariants) : null;
    if (
      currentDominant !== null &&
      previousDominant !== null &&
      currentDominant !== previousDominant
    ) {
      items.push({
        category,
        type: 'dominant-shift',
        variant: currentDominant,
        detail: `Dominant pattern shifted from "${previousDominant}" to "${currentDominant}"`,
      });
    }

    // proportion-change: |current_share - previous_share| > threshold
    // Skip if either total is 0 to avoid division by zero
    if (currentTotal > 0 && previousTotal > 0 && previousVariants) {
      for (const [variant, count] of Object.entries(currentVariants)) {
        const currentShare = count / currentTotal;
        const prevCount = previousVariants[variant] ?? 0;
        const previousShare = prevCount / previousTotal;
        if (Math.abs(currentShare - previousShare) > proportionThreshold) {
          const currentPct = Math.round(currentShare * 100);
          const prevPct = Math.round(previousShare * 100);
          items.push({
            category,
            type: 'proportion-change',
            variant,
            detail: `"${variant}" share changed from ${prevPct}% to ${currentPct}% (${Math.abs(currentPct - prevPct)}% absolute change)`,
          });
        }
      }
    }
  }

  return items;
}
