import { join } from 'node:path';
import { loadConfig, findProjectRoot } from '../../config/index.js';
import { safeWriteFile } from '../../utils/fs.js';
import { success, warn, info, heading, plain } from '../../utils/index.js';
import type { DriftItem } from './scanners.js';
import {
  scanGoldenPrincipleViolations,
  scanDeadCode,
  scanStaleDocumentation,
  scanPatternInconsistency,
} from './scanners.js';
import type { HistoryEntry } from './history.js';
import { loadHistory, saveHistoryEntry, detectTrend } from './history.js';
import { formatTemporalView, loadPatternHistory } from './fingerprint.js';

interface GcOptions {
  json?: boolean | undefined;
  fixDescriptions?: boolean | undefined;
  severity?: string | undefined;
  category?: string | undefined;
  temporal?: boolean | undefined;
  last?: number | undefined;
}

export function gcCommand(options: GcOptions): void {
  const projectRoot = findProjectRoot(process.cwd());
  const { config, warnings } = loadConfig(projectRoot);

  if (options.temporal) {
    const history = loadPatternHistory(projectRoot);
    if (options.json) {
      plain(JSON.stringify(history.slice(-(options.last ?? 10)), null, 2));
    } else {
      plain(formatTemporalView(history, options.last ?? 10));
    }
    return;
  }

  if (!options.json) {
    for (const w of warnings) warn(w);
  }

  let items: DriftItem[] = [
    ...scanGoldenPrincipleViolations(projectRoot, config),
    ...scanDeadCode(projectRoot, config),
    ...scanStaleDocumentation(projectRoot, config),
    ...scanPatternInconsistency(projectRoot, config),
  ];

  // Filter by severity
  if (options.severity) {
    items = items.filter(i => i.severity === options.severity);
  }

  // Filter by category
  const VALID_CATEGORIES = ['principle-violation', 'dead-code', 'stale-documentation', 'pattern-inconsistency'];
  if (options.category) {
    if (!VALID_CATEGORIES.includes(options.category)) {
      const msg = `Unknown category "${options.category}". Valid categories: ${VALID_CATEGORIES.join(', ')}`;
      if (options.json) {
        plain(JSON.stringify({ error: msg }, null, 2));
      } else {
        warn(msg);
      }
      return;
    }
    items = items.filter(i => i.category === options.category);
  }

  // Deduplication by description
  const seen = new Set<string>();
  items = items.filter(item => {
    const key = `${item.category}:${item.file}:${item.description}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Compute item fingerprints for cross-run dedup
  const itemKeys = items.map(i => `${i.category}:${i.file}:${i.description.split('(')[0]!.trim()}`);

  // Save history entry
  const categoryCount: Record<string, number> = {};
  for (const item of items) {
    categoryCount[item.category] = (categoryCount[item.category] ?? 0) + 1;
  }

  const historyEntry: HistoryEntry = {
    timestamp: new Date().toISOString(),
    total: items.length,
    critical: items.filter(i => i.severity === 'critical').length,
    warning: items.filter(i => i.severity === 'warning').length,
    info: items.filter(i => i.severity === 'info').length,
    categories: categoryCount,
    itemKeys,
  };

  const history = loadHistory(projectRoot);

  // Cross-run deduplication: count how many consecutive previous runs each item appeared in
  const persistentCounts = new Map<string, number>();
  for (const key of itemKeys) {
    let count = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i]!.itemKeys?.includes(key)) {
        count++;
      } else {
        break;
      }
    }
    if (count > 0) persistentCounts.set(key, count);
  }

  saveHistoryEntry(projectRoot, historyEntry);

  // Annotate persistent items
  const persistentItems = items.map((item, idx) => {
    const key = itemKeys[idx]!;
    const runCount = persistentCounts.get(key);
    return {
      ...item,
      persistentRuns: runCount ? runCount + 1 : undefined, // +1 counting current run
    };
  });

  // Output
  if (options.json) {
    const trend = detectTrend([...history, historyEntry]);
    plain(JSON.stringify({
      items: persistentItems.map(i => ({
        ...i,
        ...(i.persistentRuns ? { persistentRuns: i.persistentRuns } : {}),
      })),
      summary: {
        total: items.length,
        critical: historyEntry.critical,
        warning: historyEntry.warning,
        info: historyEntry.info,
        persistent: persistentItems.filter(i => i.persistentRuns && i.persistentRuns >= 2).length,
      },
      trend: trend ? { direction: trend.direction, message: trend.message } : null,
    }, null, 2));
  } else if (options.fixDescriptions) {
    let md = `# Drift Report — Fix Descriptions\n\nGenerated: ${new Date().toISOString()}\n\n`;
    for (const item of items) {
      md += `- [ ] **${item.file}**: ${item.description}\n  Fix: ${item.fix}\n\n`;
    }
    const fixPath = join(projectRoot, '.ralph', 'gc-fix-descriptions.md');
    safeWriteFile(fixPath, md);
    success(`Generated fix descriptions: .ralph/gc-fix-descriptions.md (${items.length} items)`);
  } else {
    if (items.length === 0) {
      success('No drift detected');
    } else {
      const categories = [...new Set(persistentItems.map(i => i.category))];
      for (const cat of categories) {
        plain('');
        heading(cat.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()));
        const catItems = persistentItems.filter(i => i.category === cat);
        for (const item of catItems) {
          const prefix = item.severity === 'critical' ? '✗' : item.severity === 'warning' ? '⚠' : 'ℹ';
          const persistTag = item.persistentRuns && item.persistentRuns >= 2 ? ` [persistent: ${item.persistentRuns} runs]` : '';
          plain(`  ${prefix} ${item.file}: ${item.description}${persistTag}`);
          plain(`    Fix: ${item.fix}`);
        }
      }
      plain('');
      info(`${items.length} drift item(s) found`);
    }

    // Show trend
    const trend = detectTrend([...history, historyEntry]);
    if (trend) {
      plain('');
      if (trend.direction === 'rising') {
        warn(trend.message);
      } else if (trend.direction === 'declining') {
        success(trend.message);
      } else {
        info(trend.message);
      }
    }
  }

  // Write report
  const reportPath = join(projectRoot, '.ralph', 'gc-report.md');
  let report = `# Drift Report\n\nGenerated: ${new Date().toISOString()}\n\n`;
  report += `| Category | File | Severity | Description |\n`;
  report += `|----------|------|----------|-------------|\n`;
  for (const item of items) {
    report += `| ${item.category} | ${item.file} | ${item.severity} | ${item.description} |\n`;
  }
  safeWriteFile(reportPath, report);
}
