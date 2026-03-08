import { join } from 'node:path';
import { readFileSync, existsSync, appendFileSync, readdirSync, statSync } from 'node:fs';
import { loadConfig, findProjectRoot } from '../../config/index.js';
import type { RalphConfig, Grade } from '../../config/schema.js';
import { success, warn, error, info } from '../../utils/index.js';
import { safeWriteFile } from '../../utils/fs.js';
import { collectFiles } from '../lint/files.js';
import { runRules } from '../lint/engine.js';
import { createDependencyDirectionRule } from '../lint/rules/dependency-direction.js';
import { createFileSizeRule } from '../lint/rules/file-size.js';
import { createNamingConventionRule } from '../lint/rules/naming-convention.js';

interface GradeOptions {
  ci?: boolean | undefined;
  trend?: boolean | undefined;
}

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
  overall: Grade;
}

const GRADE_ORDER: Grade[] = ['A', 'B', 'C', 'D', 'F'];

function gradeFromPercentage(pct: number): Grade {
  if (pct >= 90) return 'A';
  if (pct >= 75) return 'B';
  if (pct >= 60) return 'C';
  if (pct >= 40) return 'D';
  return 'F';
}

function worstGrade(...grades: Grade[]): Grade {
  let worst = 0;
  for (const g of grades) {
    const idx = GRADE_ORDER.indexOf(g);
    if (idx > worst) worst = idx;
  }
  return GRADE_ORDER[worst]!;
}

function gradeIsBelow(grade: Grade, minimum: Grade): boolean {
  return GRADE_ORDER.indexOf(grade) > GRADE_ORDER.indexOf(minimum);
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
    // Parse lcov format for line coverage
    const linesFound = content.match(/LF:(\d+)/g);
    const linesHit = content.match(/LH:(\d+)/g);

    if (linesFound && linesHit) {
      let totalFound = 0;
      let totalHit = 0;
      for (const m of linesFound) totalFound += parseInt(m.replace('LF:', ''), 10);
      for (const m of linesHit) totalHit += parseInt(m.replace('LH:', ''), 10);
      const pct = totalFound > 0 ? Math.round((totalHit / totalFound) * 100) : 0;
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
  const rules = [
    createDependencyDirectionRule(config.architecture),
    createFileSizeRule(config.architecture.files['max-lines']),
    createNamingConventionRule(config.architecture.files.naming),
  ];
  const result = runRules(rules, { projectRoot, files });
  const errorCount = result.violations.filter(v => v.severity === 'error').length;

  if (errorCount === 0) return { grade: 'A', detail: 'No architectural violations' };
  if (errorCount <= 2) return { grade: 'B', detail: `${errorCount} violation(s)` };
  if (errorCount <= 5) return { grade: 'C', detail: `${errorCount} violations` };
  if (errorCount <= 10) return { grade: 'D', detail: `${errorCount} violations` };
  return { grade: 'F', detail: `${errorCount} violations` };
}

function scoreFileHealth(projectRoot: string, config: RalphConfig): DimensionScore {
  const files = collectFiles(projectRoot, { exclude: config.gc.exclude });
  const maxLines = config.architecture.files['max-lines'];
  let oversized = 0;
  let totalLines = 0;

  for (const file of files) {
    try {
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n').length;
      totalLines += lines;
      if (lines > maxLines) oversized++;
    } catch { /* ignore */ }
  }

  const avgLines = files.length > 0 ? Math.round(totalLines / files.length) : 0;
  const oversizedPct = files.length > 0 ? (oversized / files.length) * 100 : 0;

  if (oversizedPct === 0) return { grade: 'A', detail: `Avg ${avgLines} lines, no oversized files` };
  if (oversizedPct < 5) return { grade: 'B', detail: `Avg ${avgLines} lines, ${oversized} oversized` };
  if (oversizedPct < 15) return { grade: 'C', detail: `Avg ${avgLines} lines, ${oversized} oversized` };
  if (oversizedPct < 30) return { grade: 'D', detail: `Avg ${avgLines} lines, ${oversized} oversized` };
  return { grade: 'F', detail: `Avg ${avgLines} lines, ${oversized} oversized` };
}

export function scoreProject(projectRoot: string, config: RalphConfig): DomainScore {
  const tests = scoreTestCoverage(projectRoot, config);
  const docs = scoreDocumentation(projectRoot, config);
  const architecture = scoreArchitecture(projectRoot, config);
  const fileHealth = scoreFileHealth(projectRoot, config);
  const overall = worstGrade(tests.grade, docs.grade, architecture.grade, fileHealth.grade);

  return {
    domain: config.project.name,
    tests,
    docs,
    architecture,
    fileHealth,
    overall,
  };
}

function generateQualityMd(scores: DomainScore[]): string {
  let md = `# Quality Score\n\n<!-- Generated by ralph grade. Do not edit manually. -->\n\n`;
  md += `| Domain | Tests | Docs | Architecture | File Health | Overall |\n`;
  md += `|--------|-------|------|--------------|-------------|----------|\n`;

  for (const s of scores) {
    md += `| ${s.domain} | ${s.tests.grade} | ${s.docs.grade} | ${s.architecture.grade} | ${s.fileHealth.grade} | **${s.overall}** |\n`;
  }

  md += `\n## Details\n\n`;
  for (const s of scores) {
    md += `### ${s.domain}\n\n`;
    md += `- **Tests**: ${s.tests.grade} — ${s.tests.detail}\n`;
    md += `- **Docs**: ${s.docs.grade} — ${s.docs.detail}\n`;
    md += `- **Architecture**: ${s.architecture.grade} — ${s.architecture.detail}\n`;
    md += `- **File Health**: ${s.fileHealth.grade} — ${s.fileHealth.detail}\n`;
    md += `- **Overall**: ${s.overall}\n\n`;
  }

  // Action items
  const failing = scores.filter(s => s.overall === 'D' || s.overall === 'F');
  if (failing.length > 0) {
    md += `## Action Items\n\n`;
    for (const s of failing) {
      if (s.tests.grade === 'D' || s.tests.grade === 'F') {
        md += `- [ ] Improve test coverage for ${s.domain} (currently: ${s.tests.detail})\n`;
      }
      if (s.docs.grade === 'D' || s.docs.grade === 'F') {
        md += `- [ ] Add missing documentation for ${s.domain} (currently: ${s.docs.detail})\n`;
      }
      if (s.architecture.grade === 'D' || s.architecture.grade === 'F') {
        md += `- [ ] Fix architectural violations in ${s.domain} (${s.architecture.detail})\n`;
      }
      if (s.fileHealth.grade === 'D' || s.fileHealth.grade === 'F') {
        md += `- [ ] Reduce file sizes in ${s.domain} (${s.fileHealth.detail})\n`;
      }
    }
  }

  return md;
}

function appendTrend(projectRoot: string, scores: DomainScore[]): void {
  const historyPath = join(projectRoot, '.ralph', 'grade-history.jsonl');
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    scores: scores.map(s => ({
      domain: s.domain,
      tests: s.tests.grade,
      docs: s.docs.grade,
      architecture: s.architecture.grade,
      fileHealth: s.fileHealth.grade,
      overall: s.overall,
    })),
  });
  appendFileSync(historyPath, entry + '\n');
}

export function gradeCommand(domain: string | undefined, options: GradeOptions): void {
  const projectRoot = findProjectRoot(process.cwd());
  const { config, warnings } = loadConfig(projectRoot);

  for (const w of warnings) warn(w);

  const scores = [scoreProject(projectRoot, config)];

  // Generate quality markdown
  const qualityPath = join(projectRoot, config.paths.quality);
  const qualityMd = generateQualityMd(scores);
  safeWriteFile(qualityPath, qualityMd);
  success(`Updated ${config.paths.quality}`);

  // Append to trend history
  appendTrend(projectRoot, scores);

  // Display
  for (const s of scores) {
    console.log('');
    info(`${s.domain}: Overall grade ${s.overall}`);
    console.log(`  Tests: ${s.tests.grade} (${s.tests.detail})`);
    console.log(`  Docs: ${s.docs.grade} (${s.docs.detail})`);
    console.log(`  Architecture: ${s.architecture.grade} (${s.architecture.detail})`);
    console.log(`  File Health: ${s.fileHealth.grade} (${s.fileHealth.detail})`);
  }

  // CI mode
  if (options.ci) {
    const minGrade = config.quality['minimum-grade'];
    const failing = scores.filter(s => gradeIsBelow(s.overall, minGrade));
    if (failing.length > 0) {
      console.log('');
      error(`${failing.length} domain(s) below minimum grade ${minGrade}`);
      process.exit(1);
    }
  }
}
