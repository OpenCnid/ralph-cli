import { readFileSync } from 'node:fs';
import type { ScoreResult } from './types.js';
import type { RalphConfig } from '../../config/schema.js';

const PASS_PATTERNS = [
  /(\d+)\s+passed/,
  /Tests:\s+(\d+)\s+passed/,
  /(\d+)\s+passing/,
  /(\d+)\s+tests?\s+passed/,
  /passed:\s*(\d+)/i,
];

const FAIL_PATTERNS = [
  /(\d+)\s+failed/,
  /Tests:\s+\d+\s+passed,\s+(\d+)\s+failed/,
];

function parseTestCounts(stdout: string): { passed: number; failed: number } | null {
  let passed: number | null = null;
  for (const pattern of PASS_PATTERNS) {
    const m = pattern.exec(stdout);
    if (m != null) {
      passed = parseInt(m[1]!, 10);
      break;
    }
  }
  if (passed == null) return null;

  let failed = 0;
  for (const pattern of FAIL_PATTERNS) {
    const m = pattern.exec(stdout);
    if (m != null) {
      failed = parseInt(m[1]!, 10);
      break;
    }
  }

  return { passed, failed };
}

interface CoverageData {
  total?: { statements?: { pct?: unknown }; lines?: { pct?: unknown } };
  statements?: { pct?: unknown };
  lines?: { pct?: unknown };
}

function parseCoverageJson(reportPath: string): number | null {
  let raw: string;
  try {
    raw = readFileSync(reportPath, 'utf-8');
  } catch {
    return null;
  }

  let data: CoverageData;
  try {
    data = JSON.parse(raw) as CoverageData;
  } catch {
    return null;
  }

  // Priority order per spec — return immediately on first match
  const pct =
    data?.total?.statements?.pct ??
    data?.total?.lines?.pct ??
    data?.statements?.pct ??
    data?.lines?.pct;

  if (typeof pct !== 'number' || pct < 0 || pct > 100) return null;
  return pct;
}

/**
 * Run the built-in scorer using test stdout and coverage JSON.
 * Returns a ScoreResult with source='default'.
 */
export function runDefaultScorer(testStdout: string, config: RalphConfig): ScoreResult {
  const reportPath = config.quality.coverage['report-path'];
  const weights = config.scoring?.['default-weights'] ?? { tests: 0.6, coverage: 0.4 };

  const testCounts = parseTestCounts(testStdout);
  const coveragePct = parseCoverageJson(reportPath);

  const metrics: Record<string, string> = {};

  let testRate: number | null = null;
  if (testCounts != null) {
    const total = testCounts.passed + testCounts.failed;
    testRate = total > 0 ? testCounts.passed / total : 1.0;
    metrics['test_count'] = String(testCounts.passed);
    metrics['test_total'] = String(total);
    metrics['test_rate'] = testRate.toFixed(4);
  } else {
    metrics['test_count'] = '0';
    metrics['test_total'] = '0';
    metrics['test_rate'] = '0';
  }

  let coverageRate: number | null = null;
  if (coveragePct != null) {
    coverageRate = coveragePct / 100;
    metrics['coverage'] = coverageRate.toFixed(4);
  } else {
    metrics['coverage'] = '0';
  }

  let score: number | null = null;
  if (testRate != null && coverageRate != null) {
    score = testRate * weights.tests + coverageRate * weights.coverage;
  } else if (testRate != null) {
    score = testRate;
  } else if (coverageRate != null) {
    score = coverageRate;
  }

  return { score, source: 'default', scriptPath: null, metrics };
}
