import { dirname, join } from 'node:path';
import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { ensureDir, info } from '../../utils/index.js';
import type { DomainScore } from './scorers.js';
import { GRADE_ORDER } from './scorers.js';
import type { Grade } from '../../config/schema.js';

export interface HistoryEntry {
  timestamp: string;
  scores: Array<{
    domain: string;
    tests: Grade;
    docs: Grade;
    architecture: Grade;
    fileHealth: Grade;
    staleness: Grade;
    overall: Grade;
    testsDetail?: string | undefined;
    docsDetail?: string | undefined;
    architectureDetail?: string | undefined;
    fileHealthDetail?: string | undefined;
    stalenessDetail?: string | undefined;
  }>;
}

export function loadHistory(projectRoot: string): HistoryEntry[] {
  const historyPath = join(projectRoot, '.ralph', 'grade-history.jsonl');
  if (!existsSync(historyPath)) return [];

  try {
    const content = readFileSync(historyPath, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.trim());
    return lines.map(l => JSON.parse(l) as HistoryEntry);
  } catch {
    return [];
  }
}

/**
 * Format a temporal label from an ISO timestamp relative to now.
 * Returns labels like " last week", " 3 days ago", " yesterday".
 */
export function formatTemporalLabel(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    const daysAgo = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
    if (daysAgo <= 0) return ' today';
    if (daysAgo === 1) return ' yesterday';
    if (daysAgo <= 6) return ` ${daysAgo} days ago`;
    if (daysAgo <= 13) return ' last week';
    if (daysAgo <= 27) return ` ${Math.floor(daysAgo / 7)} weeks ago`;
    if (daysAgo <= 59) return ' last month';
    return ` ${Math.floor(daysAgo / 30)} months ago`;
  } catch {
    return '';
  }
}

/**
 * Compute trend descriptions by comparing current scores against recent history.
 * Detects sustained degradation (3+ consecutive drops) and sustained improvement.
 */
export function computeTrends(history: HistoryEntry[], currentScores: DomainScore[]): string[] {
  if (history.length === 0) return [];

  const trends: string[] = [];
  const dimensions = ['tests', 'docs', 'architecture', 'fileHealth', 'staleness', 'overall'] as const;

  for (const score of currentScores) {
    // Get history entries for this domain
    const domainHistory = history
      .map(h => h.scores.find(s => s.domain === score.domain))
      .filter((s): s is NonNullable<typeof s> => s != null);

    if (domainHistory.length === 0) continue;

    const prev = domainHistory[domainHistory.length - 1]!;

    // Compute temporal label from the most recent history entry timestamp
    const prevTimestamp = history[history.length - 1]?.timestamp;
    const timeLabel = prevTimestamp ? formatTemporalLabel(prevTimestamp) : '';

    for (const dim of dimensions) {
      const currentGrade = dim === 'overall' ? score.overall
        : dim === 'staleness' ? score.staleness.grade
        : score[dim].grade;
      const prevGrade = prev[dim] as Grade | undefined;
      if (!prevGrade) continue;

      const currentIdx = GRADE_ORDER.indexOf(currentGrade);
      const prevIdx = GRADE_ORDER.indexOf(prevGrade);

      // Get detail strings for reason context
      const currentDetail = dim === 'overall' ? undefined
        : dim === 'staleness' ? score.staleness.detail
        : score[dim].detail;
      const prevDetail = dim === 'overall' ? undefined
        : prev[`${dim}Detail` as keyof typeof prev] as string | undefined;

      // Generate a concise reason from the detail string
      const reason = currentDetail ? ` — ${currentDetail}` : '';

      if (currentIdx < prevIdx) {
        trends.push(`${score.domain}/${dim}: ${currentGrade} (was ${prevGrade}${timeLabel}) — improved${reason}`);
      } else if (currentIdx > prevIdx) {
        trends.push(`${score.domain}/${dim}: ${currentGrade} (was ${prevGrade}${timeLabel}) — degraded${reason}`);
      } else {
        const stableReason = currentDetail ? ` — ${currentDetail}` : '';
        trends.push(`${score.domain}/${dim}: ${currentGrade} (stable)${stableReason}`);
      }
    }

    // Detect sustained degradation/improvement per dimension (including overall)
    // This checks each dimension individually for 3+ consecutive drops or improvements
    if (domainHistory.length >= 2) {
      for (const dim of dimensions) {
        // Collect historical grades for this dimension
        const dimHistory = domainHistory.map(h => h[dim] as Grade | undefined).filter((g): g is Grade => g != null);
        if (dimHistory.length < 2) continue;

        const currentGrade = dim === 'overall' ? score.overall
          : dim === 'staleness' ? score.staleness.grade
          : score[dim].grade;

        // Check for sustained drops
        let consecutiveDrops = 0;
        for (let i = dimHistory.length - 1; i >= 1; i--) {
          const curr = GRADE_ORDER.indexOf(dimHistory[i]!);
          const prev = GRADE_ORDER.indexOf(dimHistory[i - 1]!);
          if (curr > prev) {
            consecutiveDrops++;
          } else {
            break;
          }
        }
        const lastIdx = GRADE_ORDER.indexOf(dimHistory[dimHistory.length - 1]!);
        const curIdx = GRADE_ORDER.indexOf(currentGrade);
        if (curIdx > lastIdx) consecutiveDrops++;

        if (consecutiveDrops >= 3) {
          trends.push(`${score.domain}/${dim}: sustained degradation (${consecutiveDrops} consecutive drops)`);
        }

        // Check for sustained improvements
        let consecutiveImproves = 0;
        for (let i = dimHistory.length - 1; i >= 1; i--) {
          const curr = GRADE_ORDER.indexOf(dimHistory[i]!);
          const prev = GRADE_ORDER.indexOf(dimHistory[i - 1]!);
          if (curr < prev) {
            consecutiveImproves++;
          } else {
            break;
          }
        }
        if (curIdx < lastIdx) consecutiveImproves++;

        if (consecutiveImproves >= 3) {
          trends.push(`${score.domain}/${dim}: sustained improvement (${consecutiveImproves} consecutive improvements)`);
        }
      }
    }
  }

  return trends;
}

export function appendTrend(projectRoot: string, scores: DomainScore[]): void {
  const historyPath = join(projectRoot, '.ralph', 'grade-history.jsonl');
  ensureDir(dirname(historyPath));
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    scores: scores.map(s => ({
      domain: s.domain,
      tests: s.tests.grade,
      docs: s.docs.grade,
      architecture: s.architecture.grade,
      fileHealth: s.fileHealth.grade,
      staleness: s.staleness.grade,
      overall: s.overall,
      testsDetail: s.tests.detail,
      docsDetail: s.docs.detail,
      architectureDetail: s.architecture.detail,
      fileHealthDetail: s.fileHealth.detail,
      stalenessDetail: s.staleness.detail,
    })),
  });
  appendFileSync(historyPath, entry + '\n');
}

export function displayTrend(history: HistoryEntry[]): void {
  if (history.length === 0) {
    info('No grade history available. Run ralph grade multiple times to build trend data.');
    return;
  }

  const dimensions = ['tests', 'docs', 'architecture', 'fileHealth', 'staleness', 'overall'] as const;
  const recent = history.slice(-10); // last 10 snapshots

  console.log('');
  info(`Grade trend (last ${recent.length} snapshot${recent.length === 1 ? '' : 's'}):`);
  console.log('');

  // Group by domain
  const domains = new Set<string>();
  for (const entry of recent) {
    for (const s of entry.scores) domains.add(s.domain);
  }

  for (const domain of domains) {
    console.log(`  ${domain}:`);
    for (const dim of dimensions) {
      const grades = recent
        .map(e => e.scores.find(s => s.domain === domain))
        .filter((s): s is NonNullable<typeof s> => s != null)
        .map(s => s[dim] as Grade);
      if (grades.length > 0) {
        console.log(`    ${dim}: ${grades.join(' -> ')}`);
      }
    }
    console.log('');
  }
}
