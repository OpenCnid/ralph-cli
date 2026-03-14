import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { basename, dirname, join, relative } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { RalphConfig } from '../../config/schema.js';
import { safeReadFile } from '../../utils/fs.js';
import { collectFiles } from '../lint/files.js';
import { parseImports } from '../lint/imports.js';

export type Severity = 'critical' | 'warning' | 'info';
export interface DriftItem {
  category: string;
  file: string;
  line?: number | undefined;
  description: string;
  severity: Severity;
  fix: string;
}
export interface AntiPattern {
  name: string;
  /** Regex to match the anti-pattern in file content */
  regex: RegExp;
  /** Keywords to match against principles in core-beliefs.md */
  keywords: string[];
  description: (match: RegExpMatchArray, file: string) => string;
  severity: Severity;
  fix: string;
}

export const gcRuntime = {
  execSync,
};

export const ANTI_PATTERNS: AntiPattern[] = [
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

export function loadCustomAntiPatterns(projectRoot: string): AntiPattern[] {
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

export function parsePrinciples(projectRoot: string, config: RalphConfig): string[] {
  const principles: string[] = [];
  const beliefsPath = join(projectRoot, config.paths['design-docs'], 'core-beliefs.md');
  const files = [beliefsPath];
  const docsDir = join(projectRoot, config.paths.docs);
  for (const name of ['RELIABILITY.md', 'SECURITY.md']) {
    files.push(join(docsDir, name));
  }

  for (const filePath of files) {
    const content = safeReadFile(filePath);
    if (!content) continue;
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

export function findMatchingPrinciple(principles: string[], keywords: string[]): string | null {
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

export function scanGoldenPrincipleViolations(projectRoot: string, config: RalphConfig): DriftItem[] {
  const items: DriftItem[] = [];
  const principles = parsePrinciples(projectRoot, config);
  const files = collectFiles(projectRoot, { exclude: config.gc.exclude });
  const allPatterns = [...ANTI_PATTERNS, ...loadCustomAntiPatterns(projectRoot)];
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
      pattern.regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      const violationLines: number[] = [];

      while ((match = pattern.regex.exec(content)) !== null) { // standard RegExp.exec loop — null signals end of matches
        const upToMatch = content.slice(0, match.index);
        const lineNum = upToMatch.split('\n').length;
        violationLines.push(lineNum);
        if (match.index === pattern.regex.lastIndex) {
          pattern.regex.lastIndex++;
        }
      }

      if (violationLines.length === 0) continue;
      // Check if line is a comment
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

export function scanDeadCode(projectRoot: string, config: RalphConfig): DriftItem[] {
  const items: DriftItem[] = [];
  const files = collectFiles(projectRoot, { exclude: config.gc.exclude });
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
      // Try to find when the file was last imported (removed from imports) using git
      let gitContext = '';
      try {
        // Search git log for the last commit that changed a reference to this file's base name
        const baseName = exportingFile.replace(/^.*\//, '').replace(/\.[^.]+$/, '');
        const gitOutput = gcRuntime.execSync(
          `git log -1 --format="%h %at" -S "${baseName}" -- "*.ts" "*.tsx" "*.js" "*.jsx"`,
          { cwd: projectRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
        ).trim();
        if (gitOutput) {
          const parts = gitOutput.split(' ');
          const commitHash = parts[0];
          const timestamp = parseInt(parts[1] ?? '0', 10) * 1000;
          if (timestamp > 0) {
            const date = new Date(timestamp);
            const dateStr = date.toISOString().split('T')[0];
            gitContext = ` (last referenced in commit ${commitHash}, ${dateStr})`;
          }
        }
      } catch { /* git not available or no history */ }

      items.push({
        category: 'dead-code',
        file: exportingFile,
        description: `File exports symbols but is not imported by any other file${gitContext}`,
        severity: 'info',
        fix: `Delete ${exportingFile} if no longer needed, or document why it is retained`,
      });
    }
  }

  const allFiles = collectFiles(projectRoot, { exclude: config.gc.exclude, includeTests: true });
  for (const file of allFiles) {
    const rel = relative(projectRoot, file).replace(/\\/g, '/');
    if (rel.includes('.test.') || rel.includes('.spec.')) {
      const fileName = basename(file);
      const testBase = fileName.replace(/\.(test|spec)\.(ts|tsx|js|jsx|py|go)$/, '');
      const ext = fileName.match(/\.(ts|tsx|js|jsx|py|go)$/)?.[0] ?? '.ts';
      const testDir = dirname(file);
      const dirName = basename(testDir);

      const directSourcePath = join(testDir, testBase + ext);
      if (existsSync(directSourcePath)) {
        continue;
      }

      if (testBase === dirName) {
        const indexSourcePath = join(testDir, `index${ext}`);
        if (existsSync(indexSourcePath)) {
          continue;
        }
      }

      const indexInSameDir = join(testDir, `index${ext}`);
      if (existsSync(indexInSameDir)) {
        continue;
      }

      const sourceFile = relative(projectRoot, directSourcePath).replace(/\\/g, '/');
      if (!existsSync(directSourcePath)) {
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

export function scanStaleDocumentation(projectRoot: string, config: RalphConfig): DriftItem[] {
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
              // Try to find when the file was deleted using git
              let gitContext = '';
              try {
                const gitOutput = gcRuntime.execSync(
                  `git log -1 --format="%h %at" --diff-filter=D -- "${path}"`,
                  { cwd: projectRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
                ).trim();
                if (gitOutput) {
                  const parts = gitOutput.split(' ');
                  const commitHash = parts[0];
                  const timestamp = parseInt(parts[1] ?? '0', 10) * 1000;
                  if (timestamp > 0) {
                    const daysAgo = Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24));
                    gitContext = ` (deleted ${daysAgo} day(s) ago in commit ${commitHash})`;
                  }
                }
              } catch { /* git not available or no history */ }

              items.push({
                category: 'stale-documentation',
                file: rel,
                description: `References non-existent file: ${path}${gitContext}`,
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

export type PatternData = Record<string, Map<string, { files: string[]; fileLines: Map<string, number> }>>;

export function collectPatternData(projectRoot: string, config: RalphConfig): PatternData {
  const files = collectFiles(projectRoot, { exclude: config.gc.exclude });
  type PatternEntry = { files: string[]; fileLines: Map<string, number> };
  const patterns: PatternData = {
    'error-handling': new Map<string, PatternEntry>(),
    'export-style': new Map<string, PatternEntry>(),
    'null-checking': new Map<string, PatternEntry>(),
  };
  function addPattern(category: string, pattern: string, rel: string, lineNum: number): void {
    const entry = patterns[category]!.get(pattern) ?? { files: [], fileLines: new Map<string, number>() };
    entry.files.push(rel);
    entry.fileLines.set(rel, lineNum);
    patterns[category]!.set(pattern, entry);
  }
  function findFirstLine(content: string, regex: RegExp): number {
    const match = regex.exec(content);
    if (!match) return 1;
    return content.slice(0, match.index).split('\n').length;
  }

  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf-8');
      const rel = relative(projectRoot, file).replace(/\\/g, '/');

      // Skip test files for pattern consistency
      if (rel.includes('.test.') || rel.includes('.spec.')) continue;

      // Error handling patterns
      if (content.includes('try {')) {
        addPattern('error-handling', 'try-catch', rel, findFirstLine(content, /try\s*\{/));
      }
      if (/\.catch\(/.test(content)) {
        addPattern('error-handling', '.catch()', rel, findFirstLine(content, /\.catch\(/));
      }

      // Export style patterns
      if (/^export\s+default\s+/m.test(content)) {
        addPattern('export-style', 'default-export', rel, findFirstLine(content, /^export\s+default\s+/m));
      }
      if (/^export\s+(?:const|function|class|interface|type|enum)\s+/m.test(content)) {
        addPattern('export-style', 'named-export', rel, findFirstLine(content, /^export\s+(?:const|function|class|interface|type|enum)\s+/m));
      }

      // Null checking patterns
      if (/===?\s*null\b/.test(content)) {
        addPattern('null-checking', '=== null', rel, findFirstLine(content, /===?\s*null\b/));
      }
      if (/!==?\s*null\b/.test(content)) {
        addPattern('null-checking', '!== null', rel, findFirstLine(content, /!==?\s*null\b/));
      }
      if (/\?\?/.test(content)) {
        addPattern('null-checking', 'nullish-coalescing', rel, findFirstLine(content, /\?\?/));
      }
    } catch { /* ignore */ }
  }

  return patterns;
}

export function scanPatternInconsistency(projectRoot: string, config: RalphConfig): DriftItem[] {
  const items: DriftItem[] = [];
  const threshold = config.gc['consistency-threshold'];
  const patterns = collectPatternData(projectRoot, config);
  for (const [category, variants] of Object.entries(patterns)) {
    if (variants.size < 2) continue;

    const totalFiles = [...variants.values()].reduce((sum, entry) => sum + entry.files.length, 0);
    let dominant = '';
    let dominantCount = 0;

    for (const [pattern, entry] of variants) {
      if (entry.files.length > dominantCount) {
        dominant = pattern;
        dominantCount = entry.files.length;
      }
    }

    const dominancePct = Math.round((dominantCount / totalFiles) * 100);
    if (dominancePct < threshold) {
      for (const [pattern, entry] of variants) {
        if (pattern === dominant) continue;
        const firstFile = entry.files[0] ?? '';
        const firstLine = entry.fileLines.get(firstFile);
        items.push({
          category: 'pattern-inconsistency',
          file: firstFile,
          line: firstLine,
          description: `${category}: "${pattern}" used in ${entry.files.length} files vs dominant "${dominant}" in ${dominantCount} files (${dominancePct}% dominance)`,
          severity: 'warning',
          fix: `Consider migrating from "${pattern}" to "${dominant}" for consistency`,
        });
      }
    }
  }

  return items;
}
