import { existsSync, readFileSync, readdirSync, statSync, appendFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { loadConfig, findProjectRoot } from '../../config/index.js';
import type { RalphConfig } from '../../config/schema.js';
import { safeWriteFile, safeReadFile } from '../../utils/fs.js';
import { success, warn, error, info, heading } from '../../utils/index.js';
import { collectFiles } from '../lint/files.js';
import { parseImports } from '../lint/imports.js';

type Severity = 'critical' | 'warning' | 'info';

interface DriftItem {
  category: string;
  file: string;
  line?: number | undefined;
  description: string;
  severity: Severity;
  fix: string;
}

interface GcOptions {
  json?: boolean | undefined;
  fixDescriptions?: boolean | undefined;
  severity?: string | undefined;
}

interface HistoryEntry {
  timestamp: string;
  total: number;
  critical: number;
  warning: number;
  info: number;
  categories: Record<string, number>;
}

// --- Anti-pattern detectors for golden principle violations ---

interface AntiPattern {
  name: string;
  /** Regex to match the anti-pattern in file content */
  regex: RegExp;
  /** Keywords to match against principles in core-beliefs.md */
  keywords: string[];
  description: (match: RegExpMatchArray, file: string) => string;
  severity: Severity;
  fix: string;
}

const ANTI_PATTERNS: AntiPattern[] = [
  {
    name: 'empty-catch',
    regex: /catch\s*\([^)]*\)\s*\{\s*\}/g,
    keywords: ['error', 'swallow', 'handle', 'catch', 'exception'],
    description: () => 'Empty catch block swallows errors silently',
    severity: 'critical',
    fix: 'Add error handling logic or re-throw the error instead of swallowing it',
  },
  {
    name: 'console-log-in-source',
    regex: /\bconsole\.(log|warn|error|debug|info)\s*\(/g,
    keywords: ['log', 'debug', 'console', 'logging', 'structured'],
    description: (match) => `Uses ${match[0].replace(/\s*\($/, '')} instead of structured logging`,
    severity: 'warning',
    fix: 'Replace console calls with a structured logger or remove debug logging',
  },
  {
    name: 'any-type',
    regex: /(?::\s*any\b|as\s+any\b)/g,
    keywords: ['type', 'strict', 'any', 'typing', 'safety', 'typed'],
    description: () => 'Uses `any` type, bypassing type safety',
    severity: 'warning',
    fix: 'Replace `any` with a specific type or use `unknown` with type guards',
  },
  {
    name: 'deep-optional-chaining',
    regex: /\w+(?:\?\.\w+){3,}/g,
    keywords: ['validate', 'boundary', 'probe', 'shape', 'validation', 'schema'],
    description: (match) => `Deep optional chaining (${match[0]}) suggests unvalidated data probing`,
    severity: 'warning',
    fix: 'Validate data shape at the boundary using schema validation instead of deep probing',
  },
];

function loadCustomAntiPatterns(projectRoot: string): AntiPattern[] {
  const patternsDir = join(projectRoot, '.ralph', 'gc-patterns');
  if (!existsSync(patternsDir)) return [];

  const patterns: AntiPattern[] = [];

  for (const file of readdirSync(patternsDir)) {
    if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue;

    const content = safeReadFile(join(patternsDir, file));
    if (!content) continue;

    try {
      const parsed = parseYaml(content) as Record<string, unknown>;
      if (!parsed.name || !parsed.pattern) continue;

      const name = String(parsed.name);
      const regexStr = String(parsed.pattern);
      const keywords = Array.isArray(parsed.keywords)
        ? parsed.keywords.map(String)
        : [];
      const description = String(parsed.description ?? name);
      const severity = (['critical', 'warning', 'info'].includes(String(parsed.severity))
        ? String(parsed.severity) as Severity
        : 'warning');
      const fix = String(parsed.fix ?? `Fix ${name} violation`);

      patterns.push({
        name,
        regex: new RegExp(regexStr, 'g'),
        keywords,
        description: () => description,
        severity,
        fix,
      });
    } catch { /* skip malformed files */ }
  }

  return patterns;
}

function parsePrinciples(projectRoot: string, config: RalphConfig): string[] {
  const principles: string[] = [];
  const beliefsPath = join(projectRoot, config.paths['design-docs'], 'core-beliefs.md');

  const files = [beliefsPath];
  // Also check domain docs like RELIABILITY.md, SECURITY.md
  const docsDir = join(projectRoot, config.paths.docs);
  for (const name of ['RELIABILITY.md', 'SECURITY.md']) {
    files.push(join(docsDir, name));
  }

  for (const filePath of files) {
    const content = safeReadFile(filePath);
    if (!content) continue;

    // Parse numbered entries: "1. ..." or bulleted: "- ..."
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      // Match new promote format: "- **principle.** Added DATE."
      const newFormatMatch = trimmed.match(/^-\s+\*\*(.+?)\.\*\*\s+Added\s+\d{4}-\d{2}-\d{2}\.?$/);
      if (newFormatMatch) {
        principles.push(newFormatMatch[1]!);
        continue;
      }
      // Match legacy format: "- **date** — principle" from older promote doc
      const datedMatch = trimmed.match(/^-\s+\*\*.+\*\*\s*[—–-]\s*(.+)$/);
      if (datedMatch) {
        principles.push(datedMatch[1]!);
        continue;
      }
      // Match numbered entries: "1. principle"
      const numberedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
      if (numberedMatch) {
        principles.push(numberedMatch[1]!);
        continue;
      }
      // Match simple bullet: "- principle" (not sub-bullets or headers)
      const bulletMatch = trimmed.match(/^-\s+(?!\*\*)(.+)$/);
      if (bulletMatch && !trimmed.startsWith('- [')) {
        principles.push(bulletMatch[1]!);
      }
    }
  }

  return principles;
}

function findMatchingPrinciple(principles: string[], keywords: string[]): string | null {
  for (const principle of principles) {
    const lowerPrinciple = principle.toLowerCase();
    for (const keyword of keywords) {
      if (lowerPrinciple.includes(keyword)) {
        return principle;
      }
    }
  }
  return null;
}

function scanGoldenPrincipleViolations(projectRoot: string, config: RalphConfig): DriftItem[] {
  const items: DriftItem[] = [];
  const principles = parsePrinciples(projectRoot, config);
  const files = collectFiles(projectRoot, { exclude: config.gc.exclude });
  const customPatterns = loadCustomAntiPatterns(projectRoot);
  const allPatterns = [...ANTI_PATTERNS, ...customPatterns];

  for (const file of files) {
    const rel = relative(projectRoot, file).replace(/\\/g, '/');
    // Skip test files for principle violation scanning
    if (rel.includes('.test.') || rel.includes('.spec.')) continue;

    let content: string;
    try {
      content = readFileSync(file, 'utf-8');
    } catch { continue; }

    const lines = content.split('\n');

    for (const pattern of allPatterns) {
      // Reset regex state
      pattern.regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      const violationLines: number[] = [];

      while ((match = pattern.regex.exec(content)) !== null) {
        // Find line number
        const upToMatch = content.slice(0, match.index);
        const lineNum = upToMatch.split('\n').length;
        violationLines.push(lineNum);

        // Prevent infinite loop on zero-length matches
        if (match.index === pattern.regex.lastIndex) {
          pattern.regex.lastIndex++;
        }
      }

      if (violationLines.length === 0) continue;

      // Check if this is actually in a comment (simple heuristic: skip if line starts with // or *)
      const realViolations = violationLines.filter(ln => {
        const line = lines[ln - 1];
        if (!line) return true;
        const trimmed = line.trim();
        return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
      });

      if (realViolations.length === 0) continue;

      const matchedPrinciple = findMatchingPrinciple(principles, pattern.keywords);
      const principleText = matchedPrinciple
        ? `\n  Principle: "${matchedPrinciple}"`
        : '';

      const desc = pattern.description(
        content.match(pattern.regex) as RegExpMatchArray ?? [pattern.name],
        rel
      );

      items.push({
        category: 'principle-violation',
        file: rel,
        line: realViolations[0],
        description: `${desc} (${realViolations.length} occurrence${realViolations.length > 1 ? 's' : ''}, line${realViolations.length > 1 ? 's' : ''} ${realViolations.join(', ')})${principleText}`,
        severity: pattern.severity,
        fix: pattern.fix,
      });
    }
  }

  return items;
}

function scanDeadCode(projectRoot: string, config: RalphConfig): DriftItem[] {
  const items: DriftItem[] = [];
  const files = collectFiles(projectRoot, { exclude: config.gc.exclude });

  // Build an import graph to find exports with no importers
  const importTargets = new Map<string, Set<string>>();
  const exportingFiles = new Set<string>();

  for (const file of files) {
    const rel = relative(projectRoot, file).replace(/\\/g, '/');
    const imports = parseImports(file);

    for (const imp of imports) {
      if (!imp.source.startsWith('.')) continue;
      const fileDir = relative(projectRoot, join(file, '..'));
      const resolved = join(fileDir, imp.source).replace(/\\/g, '/');
      const normalized = resolved.replace(/\.[^./]+$/, '');
      if (!importTargets.has(rel)) importTargets.set(rel, new Set());
      importTargets.get(rel)!.add(normalized);
    }

    try {
      const content = readFileSync(file, 'utf-8');
      if (/^export\s+(?:const|function|class|type|interface|enum|default)\s+/m.test(content)) {
        exportingFiles.add(rel);
      }
    } catch { /* ignore */ }
  }

  const allImportedPaths = new Set<string>();
  for (const targets of importTargets.values()) {
    for (const target of targets) {
      allImportedPaths.add(target);
      allImportedPaths.add(target + '/index');
    }
  }

  for (const exportingFile of exportingFiles) {
    const normalized = exportingFile.replace(/\.[^./]+$/, '');
    if (normalized === 'index' || exportingFile.match(/cli\.[^.]+$/)) continue;
    if (exportingFile.includes('.test.') || exportingFile.includes('.spec.')) continue;

    if (!allImportedPaths.has(normalized)) {
      items.push({
        category: 'dead-code',
        file: exportingFile,
        description: `File exports symbols but is not imported by any other file`,
        severity: 'info',
        fix: `Delete ${exportingFile} if no longer needed, or document why it is retained`,
      });
    }
  }

  // Find test files with no corresponding source
  const allFiles = collectFiles(projectRoot, { exclude: config.gc.exclude, includeTests: true });
  for (const file of allFiles) {
    const rel = relative(projectRoot, file).replace(/\\/g, '/');
    if (rel.includes('.test.') || rel.includes('.spec.')) {
      const sourceFile = rel.replace(/\.test\./, '.').replace(/\.spec\./, '.');
      const sourcePath = join(projectRoot, sourceFile);
      if (!existsSync(sourcePath)) {
        items.push({
          category: 'dead-code',
          file: rel,
          description: `Test file with no corresponding source file: ${sourceFile}`,
          severity: 'info',
          fix: `Remove ${rel} or create the corresponding source file ${sourceFile}`,
        });
      }
    }
  }

  return items;
}

function scanStaleDocumentation(projectRoot: string, config: RalphConfig): DriftItem[] {
  const items: DriftItem[] = [];
  const docsDir = join(projectRoot, config.paths.docs);

  if (!existsSync(docsDir)) return items;

  function scanDir(dir: string): void {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch { continue; }

      if (stat.isDirectory()) {
        scanDir(fullPath);
        continue;
      }

      if (!entry.endsWith('.md')) continue;

      try {
        const content = readFileSync(fullPath, 'utf-8');
        const rel = relative(projectRoot, fullPath).replace(/\\/g, '/');

        const codeRefs = content.match(/`(src\/[^`]+\.[a-z]+)`/g);
        if (codeRefs) {
          for (const ref of codeRefs) {
            const path = ref.replace(/`/g, '');
            if (!existsSync(join(projectRoot, path))) {
              items.push({
                category: 'stale-documentation',
                file: rel,
                description: `References non-existent file: ${path}`,
                severity: 'warning',
                fix: `Update ${rel} to remove or correct the reference to ${path}`,
              });
            }
          }
        }
      } catch { /* ignore */ }
    }
  }

  scanDir(docsDir);
  return items;
}

function scanPatternInconsistency(projectRoot: string, config: RalphConfig): DriftItem[] {
  const items: DriftItem[] = [];
  const files = collectFiles(projectRoot, { exclude: config.gc.exclude });
  const threshold = config.gc['consistency-threshold'];

  // Detect common pattern variants across multiple categories
  const patterns: Record<string, Map<string, string[]>> = {
    'error-handling': new Map<string, string[]>(),
    'export-style': new Map<string, string[]>(),
    'null-checking': new Map<string, string[]>(),
  };

  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf-8');
      const rel = relative(projectRoot, file).replace(/\\/g, '/');

      // Skip test files for pattern consistency
      if (rel.includes('.test.') || rel.includes('.spec.')) continue;

      // Error handling patterns
      if (content.includes('try {')) {
        const existing = patterns['error-handling']!.get('try-catch') ?? [];
        existing.push(rel);
        patterns['error-handling']!.set('try-catch', existing);
      }
      if (/\.catch\(/.test(content)) {
        const existing = patterns['error-handling']!.get('.catch()') ?? [];
        existing.push(rel);
        patterns['error-handling']!.set('.catch()', existing);
      }

      // Export style patterns
      if (/^export\s+default\s+/m.test(content)) {
        const existing = patterns['export-style']!.get('default-export') ?? [];
        existing.push(rel);
        patterns['export-style']!.set('default-export', existing);
      }
      if (/^export\s+(?:const|function|class|interface|type|enum)\s+/m.test(content)) {
        const existing = patterns['export-style']!.get('named-export') ?? [];
        existing.push(rel);
        patterns['export-style']!.set('named-export', existing);
      }

      // Null checking patterns
      if (/===?\s*null\b/.test(content)) {
        const existing = patterns['null-checking']!.get('=== null') ?? [];
        existing.push(rel);
        patterns['null-checking']!.set('=== null', existing);
      }
      if (/!==?\s*null\b/.test(content)) {
        const existing = patterns['null-checking']!.get('!== null') ?? [];
        existing.push(rel);
        patterns['null-checking']!.set('!== null', existing);
      }
      if (/\?\?/.test(content)) {
        const existing = patterns['null-checking']!.get('nullish-coalescing') ?? [];
        existing.push(rel);
        patterns['null-checking']!.set('nullish-coalescing', existing);
      }
    } catch { /* ignore */ }
  }

  // Report inconsistencies
  for (const [category, variants] of Object.entries(patterns)) {
    if (variants.size < 2) continue;

    const totalFiles = [...variants.values()].reduce((sum, files) => sum + files.length, 0);
    let dominant = '';
    let dominantCount = 0;

    for (const [pattern, files] of variants) {
      if (files.length > dominantCount) {
        dominant = pattern;
        dominantCount = files.length;
      }
    }

    const dominancePct = Math.round((dominantCount / totalFiles) * 100);
    if (dominancePct < threshold) {
      for (const [pattern, patternFiles] of variants) {
        if (pattern === dominant) continue;
        items.push({
          category: 'pattern-inconsistency',
          file: patternFiles[0] ?? '',
          description: `${category}: "${pattern}" used in ${patternFiles.length} files vs dominant "${dominant}" in ${dominantCount} files (${dominancePct}% dominance)`,
          severity: 'warning',
          fix: `Consider migrating from "${pattern}" to "${dominant}" for consistency`,
        });
      }
    }
  }

  return items;
}

// --- Trend tracking ---

function loadHistory(projectRoot: string): HistoryEntry[] {
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

function saveHistoryEntry(projectRoot: string, entry: HistoryEntry): void {
  const historyPath = join(projectRoot, '.ralph', 'gc-history.jsonl');
  const line = JSON.stringify(entry) + '\n';
  try {
    appendFileSync(historyPath, line);
  } catch {
    // Ensure directory exists and retry
    safeWriteFile(historyPath, line);
  }
}

function detectTrend(history: HistoryEntry[]): { direction: 'rising' | 'stable' | 'declining'; message: string } | null {
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

export function gcCommand(options: GcOptions): void {
  const projectRoot = findProjectRoot(process.cwd());
  const { config, warnings } = loadConfig(projectRoot);

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

  // Deduplication by description
  const seen = new Set<string>();
  items = items.filter(item => {
    const key = `${item.category}:${item.file}:${item.description}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

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
  };

  const history = loadHistory(projectRoot);
  saveHistoryEntry(projectRoot, historyEntry);

  // Output
  if (options.json) {
    const trend = detectTrend([...history, historyEntry]);
    console.log(JSON.stringify({
      items,
      summary: {
        total: items.length,
        critical: historyEntry.critical,
        warning: historyEntry.warning,
        info: historyEntry.info,
      },
      trend: trend ? { direction: trend.direction, message: trend.message } : null,
    }, null, 2));
  } else if (options.fixDescriptions) {
    let md = `# Drift Report — Fix Descriptions\n\n`;
    for (const item of items) {
      md += `- [ ] **${item.file}**: ${item.description}\n  Fix: ${item.fix}\n\n`;
    }
    console.log(md);
  } else {
    if (items.length === 0) {
      success('No drift detected');
    } else {
      const categories = [...new Set(items.map(i => i.category))];
      for (const cat of categories) {
        console.log('');
        heading(cat.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()));
        const catItems = items.filter(i => i.category === cat);
        for (const item of catItems) {
          const prefix = item.severity === 'critical' ? '✗' : item.severity === 'warning' ? '⚠' : 'ℹ';
          console.log(`  ${prefix} ${item.file}: ${item.description}`);
          console.log(`    Fix: ${item.fix}`);
        }
      }
      console.log('');
      info(`${items.length} drift item(s) found`);
    }

    // Show trend
    const trend = detectTrend([...history, historyEntry]);
    if (trend) {
      console.log('');
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
