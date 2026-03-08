import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { safeWriteFile, safeReadFile } from '../../utils/fs.js';
import { ensureDir } from '../../utils/index.js';

export interface HistoryEntry {
  timestamp: string;
  total: number;
  critical: number;
  warning: number;
  info: number;
  categories: Record<string, number>;
  /** Fingerprints of drift items for cross-run deduplication */
  itemKeys?: string[] | undefined;
}

export function loadHistory(projectRoot: string): HistoryEntry[] {
  const historyPath = join(projectRoot, '.ralph', 'gc-history.jsonl');
  const content = safeReadFile(historyPath);
  if (!content) return [];

  const entries: HistoryEntry[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as HistoryEntry);
    } catch { /* skip malformed lines */ }
  }
  return entries;
}

export function saveHistoryEntry(projectRoot: string, entry: HistoryEntry): void {
  const historyPath = join(projectRoot, '.ralph', 'gc-history.jsonl');
  const line = JSON.stringify(entry) + '\n';
  try {
    ensureDir(dirname(historyPath));
    appendFileSync(historyPath, line);
  } catch {
    // Ensure directory exists and retry
    safeWriteFile(historyPath, line);
  }
}

export function detectTrend(history: HistoryEntry[]): { direction: 'rising' | 'stable' | 'declining'; message: string } | null {
  if (history.length < 3) return null;

  const recent = history.slice(-3);
  const totals = recent.map(e => e.total);

  // Check if consistently rising
  if (totals[0]! < totals[1]! && totals[1]! < totals[2]!) {
    return {
      direction: 'rising',
      message: `Drift is rising: ${totals.join(' → ')} items over last 3 runs. Entropy is accumulating faster than cleanup.`,
    };
  }

  // Check if consistently declining
  if (totals[0]! > totals[1]! && totals[1]! > totals[2]!) {
    return {
      direction: 'declining',
      message: `Drift is declining: ${totals.join(' → ')} items over last 3 runs. Cleanup is outpacing entropy.`,
    };
  }

  return {
    direction: 'stable',
    message: `Drift is stable: ${totals.join(' → ')} items over last 3 runs.`,
  };
}
