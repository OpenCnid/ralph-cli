import { appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { safeReadFile, ensureDir } from '../../utils/fs.js';
import * as output from '../../utils/output.js';
import type { DivergenceConfig, RalphConfig } from '../../config/schema.js';
import type { PatternData } from './scanners.js';
import { collectPatternData } from './scanners.js';

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

// F-AD07: Temporal CLI View

function formatDistribution(variants: Record<string, number>): string {
  const total = Object.values(variants).reduce((a, b) => a + b, 0);
  if (total === 0) return '(no matches)';
  const sorted = Object.entries(variants)
    .filter(([, count]) => count > 0)
    .sort(([aV, aC], [bV, bC]) => bC - aC || aV.localeCompare(bV));
  return sorted.map(([variant, count]) => {
    const pct = Math.round((count / total) * 100);
    return `${variant} (${pct}%)`;
  }).join(', ');
}

function variantsEqual(a: Record<string, number>, b: Record<string, number>): boolean {
  const nonZero = (r: Record<string, number>) => Object.entries(r).filter(([, v]) => v > 0);
  const aPairs = nonZero(a);
  const bPairs = nonZero(b);
  if (aPairs.length !== bPairs.length) return false;
  for (const [k, v] of aPairs) {
    if ((b[k] ?? 0) !== v) return false;
  }
  return true;
}

export function formatTemporalView(history: PatternFingerprint[], last: number): string {
  if (history.length === 0) {
    return 'No pattern history found. Run `ralph run build` to start tracking.';
  }

  const entries = history.slice(-last);

  const allCategories = new Set<string>();
  for (const entry of entries) {
    for (const category of Object.keys(entry.patterns)) {
      allCategories.add(category);
    }
  }

  const sections: string[] = [
    `Pattern History (last ${entries.length} iterations)`,
    '──────────────────────────────────────',
  ];

  for (const category of [...allCategories].sort()) {
    const categoryLines: string[] = ['', `${category}:`];

    interface EntryData {
      iteration: number;
      variants: Record<string, number>;
      hasDivergence: boolean;
    }

    const entryData: EntryData[] = entries.map((entry, i) => {
      const variants = entry.patterns[category] ?? {};
      let hasDivergence = false;
      if (i > 0) {
        const prevEntry = entries[i - 1];
        const prevVariants = prevEntry !== undefined ? (prevEntry.patterns[category] ?? {}) : {};
        for (const [variant, count] of Object.entries(variants)) {
          if (count > 0 && (prevVariants[variant] ?? 0) === 0) {
            hasDivergence = true;
            break;
          }
        }
      }
      return { iteration: entry.iteration, variants, hasDivergence };
    });

    interface Group {
      startIter: number;
      endIter: number;
      variants: Record<string, number>;
      hasDivergence: boolean;
    }

    const groups: Group[] = [];
    for (const ed of entryData) {
      const prev = groups[groups.length - 1];
      if (prev && !ed.hasDivergence && variantsEqual(prev.variants, ed.variants)) {
        prev.endIter = ed.iteration;
      } else {
        groups.push({
          startIter: ed.iteration,
          endIter: ed.iteration,
          variants: ed.variants,
          hasDivergence: ed.hasDivergence,
        });
      }
    }

    const isStable = groups.length === 1 && entries.length > 1;

    const maxIterLen = Math.max(
      ...groups.map(g =>
        g.startIter === g.endIter
          ? `iter ${g.startIter}:`.length
          : `iter ${g.startIter}-${g.endIter}:`.length,
      ),
    );

    for (const group of groups) {
      const iterStr =
        group.startIter === group.endIter
          ? `iter ${group.startIter}:`
          : `iter ${group.startIter}-${group.endIter}:`;
      const distStr = formatDistribution(group.variants);
      let line = `  ${iterStr.padEnd(maxIterLen + 2)}${distStr}`;
      if (group.hasDivergence) {
        line += '  ← divergence';
      } else if (isStable) {
        line += '  — stable';
      }
      categoryLines.push(line);
    }

    sections.push(...categoryLines);
  }

  return sections.join('\n');
}

// F-AD06 helper: Run loop integration

export function computeAndRecordDivergence(
  projectRoot: string,
  config: RalphConfig,
  iteration: number,
  commit: string,
): DivergenceItem[] {
  if (config.gc.divergence?.enabled === false) return [];

  const patternData = collectPatternData(projectRoot, config);
  const currentFingerprint = computeFingerprint(patternData, iteration, commit);
  const history = loadPatternHistory(projectRoot);
  const previous = history[history.length - 1] ?? null;
  const items = previous
    ? detectDivergence(currentFingerprint, previous, config.gc.divergence!)
    : [];
  appendPatternHistory(projectRoot, currentFingerprint);
  return items;
}
