import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
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

function scanDeadCode(projectRoot: string, config: RalphConfig): DriftItem[] {
  const items: DriftItem[] = [];
  const files = collectFiles(projectRoot, { exclude: config.gc.exclude });

  // Build an import graph to find exports with no importers
  // importTargets: maps each file to the set of resolved relative paths it imports
  const importTargets = new Map<string, Set<string>>();
  const exportingFiles = new Set<string>();

  for (const file of files) {
    const rel = relative(projectRoot, file).replace(/\\/g, '/');
    const imports = parseImports(file);

    for (const imp of imports) {
      if (!imp.source.startsWith('.')) continue;
      // Resolve relative import to a project-relative path
      const fileDir = relative(projectRoot, join(file, '..'));
      const resolved = join(fileDir, imp.source).replace(/\\/g, '/');
      // Normalize: strip extensions for matching
      const normalized = resolved.replace(/\.[^./]+$/, '');
      if (!importTargets.has(rel)) importTargets.set(rel, new Set());
      importTargets.get(rel)!.add(normalized);
    }

    // Find files that export symbols
    try {
      const content = readFileSync(file, 'utf-8');
      if (/^export\s+(?:const|function|class|type|interface|enum|default)\s+/m.test(content)) {
        exportingFiles.add(rel);
      }
    } catch { /* ignore */ }
  }

  // Build set of all imported paths (normalized, no extension)
  const allImportedPaths = new Set<string>();
  for (const targets of importTargets.values()) {
    for (const target of targets) {
      allImportedPaths.add(target);
      // Also add with /index since `import './foo'` may resolve to `foo/index`
      allImportedPaths.add(target + '/index');
    }
  }

  // Find exporting files with no importers
  for (const exportingFile of exportingFiles) {
    const normalized = exportingFile.replace(/\.[^./]+$/, '');
    // Skip entry points (index files at project root, CLI entry points)
    if (normalized === 'index' || exportingFile.match(/cli\.[^.]+$/)) continue;
    // Skip test files
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

  // Find test files with no corresponding source (need to include test files for this scan)
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

  // Check if any docs reference files/paths that don't exist
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

        // Look for code file references in docs
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

  // Detect common pattern variants
  const patterns: Record<string, Map<string, string[]>> = {
    'error-handling': new Map<string, string[]>(),
  };

  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf-8');
      const rel = relative(projectRoot, file).replace(/\\/g, '/');

      // Error handling patterns
      if (content.includes('try {')) {
        const existing = patterns['error-handling']!.get('try-catch') ?? [];
        existing.push(rel);
        patterns['error-handling']!.set('try-catch', existing);
      }
      if (content.match(/\.catch\(/)) {
        const existing = patterns['error-handling']!.get('.catch()') ?? [];
        existing.push(rel);
        patterns['error-handling']!.set('.catch()', existing);
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

export function gcCommand(options: GcOptions): void {
  const projectRoot = findProjectRoot(process.cwd());
  const { config, warnings } = loadConfig(projectRoot);

  if (!options.json) {
    for (const w of warnings) warn(w);
  }

  let items: DriftItem[] = [
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

  // Output
  if (options.json) {
    console.log(JSON.stringify({
      items,
      summary: {
        total: items.length,
        critical: items.filter(i => i.severity === 'critical').length,
        warning: items.filter(i => i.severity === 'warning').length,
        info: items.filter(i => i.severity === 'info').length,
      },
    }, null, 2));
  } else if (options.fixDescriptions) {
    // Markdown fix list
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
