import { join } from 'node:path';
import { loadConfig, findProjectRoot } from '../../config/index.js';
import { success, warn, error, info, plain } from '../../utils/index.js';
import { safeWriteFile } from '../../utils/fs.js';
import {
  scoreDomain,
  scoreProject,
  generateQualityMd,
  gradeIsBelow,
} from './scorers.js';
import type { DimensionScore, DomainScore } from './scorers.js';
import { loadHistory, computeTrends, appendTrend, displayTrend } from './trends.js';

export type { DimensionScore, DomainScore };
export {
  scoreDomain,
  scoreProject,
  generateQualityMd,
};
export { parseLcov, parseCoberturaXml, parseGoCoverage, parseLcovForDomain, parseGoCoverageForDomain } from './scorers.js';

interface GradeOptions {
  ci?: boolean | undefined;
  trend?: boolean | undefined;
}

export function gradeCommand(domain: string | undefined, options: GradeOptions): void {
  const projectRoot = findProjectRoot(process.cwd());
  const { config, warnings } = loadConfig(projectRoot, options.ci);

  for (const w of warnings) warn(w);

  // Load history before appending new entry
  const history = loadHistory(projectRoot);

  // --trend mode: display historical trends and exit
  if (options.trend) {
    displayTrend(history);
    return;
  }

  let scores: DomainScore[];
  const configuredDomains = config.architecture.domains ?? [];

  if (domain) {
    // Score a specific domain
    const matchedDomain = configuredDomains.find(d => d.name === domain);
    if (matchedDomain) {
      info(`Scoring domain: ${domain} (path: ${matchedDomain.path})`);
      scores = [scoreDomain(projectRoot, config, matchedDomain)];
    } else if (domain === config.project.name) {
      scores = [scoreProject(projectRoot, config)];
    } else {
      warn(`Domain "${domain}" not found in config. Scoring entire project.`);
      scores = [scoreProject(projectRoot, config)];
    }
  } else if (configuredDomains.length > 0) {
    // Score each configured domain individually
    scores = configuredDomains.map(d => scoreDomain(projectRoot, config, d));
    // Also include overall project score
    scores.push(scoreProject(projectRoot, config));
  } else {
    // No domains configured — single project score
    scores = [scoreProject(projectRoot, config)];
  }

  // Generate quality markdown with history for trend section
  const qualityPath = join(projectRoot, config.paths.quality);
  const qualityMd = generateQualityMd(scores, history);
  safeWriteFile(qualityPath, qualityMd);
  success(`Updated ${config.paths.quality}`);

  // Append to trend history
  appendTrend(projectRoot, scores);

  // Display
  for (const s of scores) {
    plain('');
    info(`${s.domain}: Overall grade ${s.overall}`);
    plain(`  Tests: ${s.tests.grade} (${s.tests.detail})`);
    plain(`  Docs: ${s.docs.grade} (${s.docs.detail})`);
    plain(`  Architecture: ${s.architecture.grade} (${s.architecture.detail})`);
    plain(`  File Health: ${s.fileHealth.grade} (${s.fileHealth.detail})`);
    plain(`  Staleness: ${s.staleness.grade} (${s.staleness.detail})`);
  }

  // Display degradation/improvement alerts
  const trends = computeTrends(history, scores);
  const alerts = trends.filter(t => t.includes('sustained'));
  if (alerts.length > 0) {
    plain('');
    for (const alert of alerts) {
      if (alert.includes('degradation')) {
        warn(alert);
      } else {
        success(alert);
      }
    }
  }

  // CI mode
  if (options.ci) {
    const minGrade = config.quality['minimum-grade'];
    const failing = scores.filter(s => gradeIsBelow(s.overall, minGrade));
    if (failing.length > 0) {
      plain('');
      error(`${failing.length} domain(s) below minimum grade ${minGrade}`);
      process.exit(1);
    }
  }
}
