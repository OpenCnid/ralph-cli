import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import type { RalphConfig, DomainConfig, Grade } from '../../config/schema.js';
import { collectFiles } from '../lint/files.js';
import { runRules } from '../lint/engine.js';
import { createDependencyDirectionRule } from '../lint/rules/dependency-direction.js';
import { createFileSizeRule } from '../lint/rules/file-size.js';
import { createNamingConventionRule } from '../lint/rules/naming-convention.js';
import { computeTrends, type HistoryEntry } from './trends.js';

export interface DimensionScore {
  grade: Grade;
  detail: string;
}

export interface DomainScore {
  domain: string;
  tests: DimensionScore;
  docs: DimensionScore;
  architecture: DimensionScore;
  fileHealth: DimensionScore;
  staleness: DimensionScore;
  overall: Grade;
}

export const gradeRuntime = {
  execSync,
};

export const GRADE_ORDER: Grade[] = ['A', 'B', 'C', 'D', 'F'];

export function gradeFromPercentage(pct: number): Grade {
  if (pct >= 90) return 'A';
  if (pct >= 75) return 'B';
  if (pct >= 60) return 'C';
  if (pct >= 40) return 'D';
  return 'F';
}

export function worstGrade(...grades: Grade[]): Grade {
  let worst = 0;
  for (const g of grades) {
    const idx = GRADE_ORDER.indexOf(g);
    if (idx > worst) worst = idx;
  }
  return GRADE_ORDER[worst]!;
}

export function gradeIsBelow(grade: Grade, minimum: Grade): boolean {
  return GRADE_ORDER.indexOf(grade) > GRADE_ORDER.indexOf(minimum);
}

/**
 * Parse lcov format (vitest, jest, c8).
 * Sums LF: (lines found) and LH: (lines hit) across all source file records.
 */
export function parseLcov(content: string): number | null {
  const linesFound = content.match(/LF:(\d+)/g);
  const linesHit = content.match(/LH:(\d+)/g);

  if (linesFound && linesHit) {
    let totalFound = 0;
    let totalHit = 0;
    for (const m of linesFound) totalFound += parseInt(m.replace('LF:', ''), 10);
    for (const m of linesHit) totalHit += parseInt(m.replace('LH:', ''), 10);
    return totalFound > 0 ? Math.round((totalHit / totalFound) * 100) : 0;
  }
  return null;
}

/**
 * Parse Cobertura XML format (pytest-cov, coverage.py, many others).
 * Extracts line-rate from the root <coverage> element (value 0.0–1.0).
 */
export function parseCoberturaXml(content: string): number | null {
  const lineRateMatch = content.match(/<coverage[^>]+line-rate="([^"]+)"/);
  if (lineRateMatch?.[1]) {
    const rate = parseFloat(lineRateMatch[1]);
    if (!isNaN(rate)) {
      return Math.round(rate * 100);
    }
  }
  return null;
}

/**
 * Parse Go coverage profile format.
 * Each line after the mode header: file:startLine.startCol,endLine.endCol numStatements count
 * A statement is covered if count > 0.
 */
export function parseGoCoverage(content: string): number | null {
  const lines = content.trim().split('\n');
  if (lines.length === 0 || !lines[0]!.startsWith('mode:')) return null;

  let totalStatements = 0;
  let coveredStatements = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    // Format: file:start,end numStatements count
    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;
    const numStatements = parseInt(parts[1]!, 10);
    const count = parseInt(parts[2]!, 10);
    if (isNaN(numStatements) || isNaN(count)) continue;
    totalStatements += numStatements;
    if (count > 0) coveredStatements += numStatements;
  }

  return totalStatements > 0 ? Math.round((coveredStatements / totalStatements) * 100) : 0;
}

/**
 * Parse lcov format filtered to files matching a domain path prefix.
 * Only includes records whose SF: path contains the domain path.
 */
export function parseLcovForDomain(content: string, domainPath: string): number | null {
  const records = content.split('end_of_record');
  let totalFound = 0;
  let totalHit = 0;

  for (const record of records) {
    const sfMatch = record.match(/SF:(.+)/);
    if (!sfMatch?.[1]) continue;
    // Match if the source file path contains the domain path
    const sf = sfMatch[1].trim();
    if (!sf.includes(domainPath)) continue;

    const lf = record.match(/LF:(\d+)/);
    const lh = record.match(/LH:(\d+)/);
    if (lf?.[1] && lh?.[1]) {
      totalFound += parseInt(lf[1], 10);
      totalHit += parseInt(lh[1], 10);
    }
  }

  return totalFound > 0 ? Math.round((totalHit / totalFound) * 100) : null;
}

/**
 * Parse Go coverage profile filtered to files matching a domain path prefix.
 */
export function parseGoCoverageForDomain(content: string, domainPath: string): number | null {
  const lines = content.trim().split('\n');
  if (lines.length === 0 || !lines[0]!.startsWith('mode:')) return null;

  let totalStatements = 0;
  let coveredStatements = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    // Format: file:start,end numStatements count
    const filePart = line.split(':')[0] ?? '';
    if (!filePart.includes(domainPath)) continue;

    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;
    const numStatements = parseInt(parts[1]!, 10);
    const count = parseInt(parts[2]!, 10);
    if (isNaN(numStatements) || isNaN(count)) continue;
    totalStatements += numStatements;
    if (count > 0) coveredStatements += numStatements;
  }

  return totalStatements > 0 ? Math.round((coveredStatements / totalStatements) * 100) : null;
}

function scoreTestCoverageForDomain(projectRoot: string, config: RalphConfig, domainPath: string): DimensionScore {
  if (config.quality.coverage.tool === 'none') {
    return { grade: 'C', detail: 'No coverage tool configured' };
  }

  const reportPath = join(projectRoot, config.quality.coverage['report-path']);
  if (!existsSync(reportPath)) {
    return { grade: 'D', detail: `Coverage report not found: ${config.quality.coverage['report-path']}` };
  }

  try {
    const content = readFileSync(reportPath, 'utf-8');
    let pct: number | null = null;

    const tool = config.quality.coverage.tool;
    if (tool === 'vitest' || tool === 'jest') {
      pct = parseLcovForDomain(content, domainPath);
    } else if (tool === 'pytest') {
      // Cobertura XML doesn't have per-file granularity at root level — fall back to project
      pct = parseLcovForDomain(content, domainPath);
    } else if (tool === 'go-test') {
      pct = parseGoCoverageForDomain(content, domainPath);
    }

    // Auto-detect fallback
    pct ??= parseLcovForDomain(content, domainPath) ?? parseGoCoverageForDomain(content, domainPath);

    if (typeof pct === 'number') {
      return { grade: gradeFromPercentage(pct), detail: `${pct}% line coverage` };
    }
  } catch { /* ignore */ }

  // No domain-specific coverage data — degrade gracefully
  return { grade: 'C', detail: `No coverage data for domain path ${domainPath}` };
}

function scoreDomainDocumentation(projectRoot: string, config: RalphConfig, domain: DomainConfig): DimensionScore {
  let score = 0;
  const total = 3;

  // Domain-specific design doc
  if (existsSync(join(projectRoot, domain.path, 'DESIGN.md'))) score++;
  if (existsSync(join(projectRoot, config.paths['design-docs'], `${domain.name}.md`))) score++;
  // Domain-level docs in design-docs subdirectory
  if (existsSync(join(projectRoot, config.paths['design-docs'], domain.name, 'DESIGN.md'))) score++;

  const pct = Math.round((score / total) * 100);
  return { grade: gradeFromPercentage(pct), detail: `${score}/${total} domain documentation files present` };
}

function scoreArchitectureForFiles(projectRoot: string, config: RalphConfig, files: string[]): DimensionScore {
  const rules = [
    createDependencyDirectionRule(config.architecture),
    createFileSizeRule(config.architecture.rules['max-lines']),
    createNamingConventionRule(config.architecture.rules.naming),
  ];
  const result = runRules(rules, { projectRoot, files });
  const errors = result.violations.filter(v => v.severity === 'error');
  const errorCount = errors.length;

  // Build detail with specific file names for actionability
  let detail: string;
  if (errorCount === 0) {
    detail = 'No architectural violations';
  } else {
    const affectedFiles = [...new Set(errors.map(v => v.file))];
    const fileList = affectedFiles.length <= 3
      ? affectedFiles.join(', ')
      : `${affectedFiles.slice(0, 3).join(', ')} +${affectedFiles.length - 3} more`;
    detail = `${errorCount} violation(s) in ${fileList}`;
  }

  if (errorCount === 0) return { grade: 'A', detail };
  if (errorCount <= 2) return { grade: 'B', detail };
  if (errorCount <= 5) return { grade: 'C', detail };
  if (errorCount <= 10) return { grade: 'D', detail };
  return { grade: 'F', detail };
}

function scoreFileHealthForFiles(files: string[], maxLines: number): DimensionScore {
  let oversized = 0;
  let totalLines = 0;
  const oversizedFiles: { file: string; lines: number }[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n').length;
      totalLines += lines;
      if (lines > maxLines) {
        oversized++;
        oversizedFiles.push({ file: file.replace(/.*[/\\]/, ''), lines });
      }
    } catch { /* ignore */ }
  }

  const avgLines = files.length > 0 ? Math.round(totalLines / files.length) : 0;
  const oversizedPct = files.length > 0 ? (oversized / files.length) * 100 : 0;

  let detail: string;
  if (oversizedPct === 0) {
    detail = `Avg ${avgLines} lines, no oversized files`;
  } else {
    oversizedFiles.sort((a, b) => b.lines - a.lines);
    const topFiles = oversizedFiles.slice(0, 3).map(f => `${f.file} (${f.lines})`);
    const extra = oversizedFiles.length > 3 ? ` +${oversizedFiles.length - 3} more` : '';
    detail = `Avg ${avgLines} lines, ${oversized} oversized: ${topFiles.join(', ')}${extra}`;
  }

  if (oversizedPct === 0) return { grade: 'A', detail };
  if (oversizedPct < 5) return { grade: 'B', detail };
  if (oversizedPct < 15) return { grade: 'C', detail };
  if (oversizedPct < 30) return { grade: 'D', detail };
  return { grade: 'F', detail };
}

function scoreStalenessForFiles(projectRoot: string, files: string[]): DimensionScore {
  if (files.length === 0) {
    return { grade: 'A', detail: 'No source files to evaluate' };
  }

  const now = Date.now();
  const daysSinceChange: number[] = [];

  for (const file of files) {
    try {
      const lastCommit = gradeRuntime.execSync(
        `git log -1 --format=%at -- "${file}"`,
        { cwd: projectRoot, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();
      if (lastCommit) {
        const lastChangeMs = parseInt(lastCommit, 10) * 1000;
        const days = Math.floor((now - lastChangeMs) / (1000 * 60 * 60 * 24));
        daysSinceChange.push(days);
      }
    } catch {
      // Not in git or git not available — skip file
    }
  }

  if (daysSinceChange.length === 0) {
    return { grade: 'C', detail: 'No git history available' };
  }

  daysSinceChange.sort((a, b) => a - b);
  const median = daysSinceChange[Math.floor(daysSinceChange.length / 2)]!;

  if (median <= 30) return { grade: 'A', detail: `Median ${median}d since last change` };
  if (median <= 90) return { grade: 'B', detail: `Median ${median}d since last change` };
  if (median <= 180) return { grade: 'C', detail: `Median ${median}d since last change` };
  if (median <= 365) return { grade: 'D', detail: `Median ${median}d since last change` };
  return { grade: 'F', detail: `Median ${median}d since last change` };
}

/**
 * Score a single configured domain by filtering files to its path.
 */
export function scoreDomain(projectRoot: string, config: RalphConfig, domain: DomainConfig): DomainScore {
  const domainDir = join(projectRoot, domain.path);
  const allFiles = collectFiles(projectRoot, { exclude: config.gc.exclude });
  const domainFiles = allFiles.filter(f => f.startsWith(domainDir + '/') || f.startsWith(domainDir + '\\'));

  const tests = scoreTestCoverageForDomain(projectRoot, config, domain.path);
  const docs = scoreDomainDocumentation(projectRoot, config, domain);
  const architecture = domainFiles.length > 0
    ? scoreArchitectureForFiles(projectRoot, config, domainFiles)
    : { grade: 'A' as Grade, detail: 'No source files in domain' };
  const fileHealth = domainFiles.length > 0
    ? scoreFileHealthForFiles(domainFiles, config.architecture.rules['max-lines'])
    : { grade: 'A' as Grade, detail: 'No source files in domain' };
  const staleness = scoreStalenessForFiles(projectRoot, domainFiles);
  const overall = worstGrade(tests.grade, docs.grade, architecture.grade, fileHealth.grade, staleness.grade);

  return { domain: domain.name, tests, docs, architecture, fileHealth, staleness, overall };
}

function scoreTestCoverage(projectRoot: string, config: RalphConfig): DimensionScore {
  if (config.quality.coverage.tool === 'none') {
    return { grade: 'C', detail: 'No coverage tool configured' };
  }

  const reportPath = join(projectRoot, config.quality.coverage['report-path']);
  if (!existsSync(reportPath)) {
    return { grade: 'D', detail: `Coverage report not found: ${config.quality.coverage['report-path']}` };
  }

  try {
    const content = readFileSync(reportPath, 'utf-8');
    let pct: number | null = null;

    // Try format based on configured tool, then auto-detect
    const tool = config.quality.coverage.tool;
    if (tool === 'vitest' || tool === 'jest') {
      pct = parseLcov(content);
      pct ??= parseCoberturaXml(content); // fallback
    } else if (tool === 'pytest') {
      pct = parseCoberturaXml(content);
      pct ??= parseLcov(content); // fallback
    } else if (tool === 'go-test') {
      pct = parseGoCoverage(content);
    }

    // Auto-detect if tool-specific parsing failed
    pct ??= parseLcov(content) ?? parseCoberturaXml(content) ?? parseGoCoverage(content);

    if (typeof pct === 'number') {
      return { grade: gradeFromPercentage(pct), detail: `${pct}% line coverage` };
    }
  } catch { /* ignore */ }

  return { grade: 'D', detail: 'Could not parse coverage report' };
}

function scoreDocumentation(projectRoot: string, config: RalphConfig): DimensionScore {
  let score = 0;
  const total = 5;

  if (existsSync(join(projectRoot, config.paths['agents-md']))) score++;
  if (existsSync(join(projectRoot, config.paths['architecture-md']))) score++;
  if (existsSync(join(projectRoot, config.paths['design-docs'], 'core-beliefs.md'))) score++;
  if (existsSync(join(projectRoot, config.paths.docs, 'DESIGN.md'))) score++;
  if (existsSync(join(projectRoot, config.paths.quality))) score++;

  const pct = Math.round((score / total) * 100);
  return { grade: gradeFromPercentage(pct), detail: `${score}/${total} documentation files present` };
}

function scoreArchitecture(projectRoot: string, config: RalphConfig): DimensionScore {
  const files = collectFiles(projectRoot, { exclude: config.gc.exclude });
  return scoreArchitectureForFiles(projectRoot, config, files);
}

function scoreFileHealth(projectRoot: string, config: RalphConfig): DimensionScore {
  const files = collectFiles(projectRoot, { exclude: config.gc.exclude });
  return scoreFileHealthForFiles(files, config.architecture.rules['max-lines']);
}

/**
 * Staleness measures how recently source files were meaningfully changed.
 * Uses git log to find last commit date per file, then computes what fraction
 * of files were touched within recent time windows.
 *
 * Grading: based on median days since last change across all source files.
 * A: median <= 30 days, B: <= 90, C: <= 180, D: <= 365, F: > 365
 */
function scoreStaleness(projectRoot: string, config: RalphConfig): DimensionScore {
  const files = collectFiles(projectRoot, { exclude: config.gc.exclude });
  return scoreStalenessForFiles(projectRoot, files);
}

export function scoreProject(projectRoot: string, config: RalphConfig): DomainScore {
  const tests = scoreTestCoverage(projectRoot, config);
  const docs = scoreDocumentation(projectRoot, config);
  const architecture = scoreArchitecture(projectRoot, config);
  const fileHealth = scoreFileHealth(projectRoot, config);
  const staleness = scoreStaleness(projectRoot, config);
  const overall = worstGrade(tests.grade, docs.grade, architecture.grade, fileHealth.grade, staleness.grade);

  return {
    domain: config.project.name,
    tests,
    docs,
    architecture,
    fileHealth,
    staleness,
    overall,
  };
}

export function generateQualityMd(scores: DomainScore[], history: HistoryEntry[]): string {
  const lastUpdated = new Date().toISOString().split('T')[0]!;
  let md = `# Quality Grades\n\nLast updated: ${lastUpdated}\n\n<!-- Generated by ralph grade. Do not edit manually. -->\n\n`;
  md += `| Domain | Tests | Docs | Architecture | File Health | Staleness | Overall |\n`;
  md += `|--------|-------|------|--------------|-------------|-----------|----------|\n`;

  for (const s of scores) {
    md += `| ${s.domain} | ${s.tests.grade} | ${s.docs.grade} | ${s.architecture.grade} | ${s.fileHealth.grade} | ${s.staleness.grade} | **${s.overall}** |\n`;
  }

  md += `\n## Details\n\n`;
  for (const s of scores) {
    md += `### ${s.domain}\n\n`;
    md += `- **Tests**: ${s.tests.grade} — ${s.tests.detail}\n`;
    md += `- **Docs**: ${s.docs.grade} — ${s.docs.detail}\n`;
    md += `- **Architecture**: ${s.architecture.grade} — ${s.architecture.detail}\n`;
    md += `- **File Health**: ${s.fileHealth.grade} — ${s.fileHealth.detail}\n`;
    md += `- **Staleness**: ${s.staleness.grade} — ${s.staleness.detail}\n`;
    md += `- **Overall**: ${s.overall}\n\n`;
  }

  // Trends section from history
  const trends = computeTrends(history, scores);
  if (trends.length > 0) {
    md += `## Trends\n\n`;
    for (const t of trends) {
      md += `- ${t}\n`;
    }
    md += '\n';
  }

  // Action items — include specific details for agent-actionable output
  const actionable = scores.filter(s => s.overall !== 'A');
  if (actionable.length > 0) {
    md += `## Action Items\n\n`;
    for (const s of actionable) {
      if (s.tests.grade === 'D' || s.tests.grade === 'F') {
        md += `- [ ] ${s.domain}: Improve test coverage (currently ${s.tests.detail})\n`;
      }
      if (s.docs.grade === 'D' || s.docs.grade === 'F') {
        md += `- [ ] ${s.domain}: Add missing documentation (${s.docs.detail})\n`;
      }
      if (s.architecture.grade === 'D' || s.architecture.grade === 'F') {
        md += `- [ ] ${s.domain}: Fix architectural violations — ${s.architecture.detail}\n`;
      } else if (s.architecture.grade === 'B' || s.architecture.grade === 'C') {
        md += `- [ ] ${s.domain}: Reduce architectural violations — ${s.architecture.detail}\n`;
      }
      if (s.fileHealth.grade === 'D' || s.fileHealth.grade === 'F') {
        md += `- [ ] ${s.domain}: Split oversized files — ${s.fileHealth.detail}\n`;
      } else if (s.fileHealth.grade === 'C') {
        md += `- [ ] ${s.domain}: Consider splitting large files — ${s.fileHealth.detail}\n`;
      }
      if (s.staleness.grade === 'D' || s.staleness.grade === 'F') {
        md += `- [ ] ${s.domain}: Review stale code — ${s.staleness.detail}\n`;
      }
    }
  }

  return md;
}
