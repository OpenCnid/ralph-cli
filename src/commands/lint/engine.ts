/**
 * Rule engine — framework for defining, loading, and executing lint rules.
 *
 * Every violation includes:
 * - what: the violation found
 * - rule: which rule it violates
 * - fix: concrete remediation steps an agent can follow
 */

export type Severity = 'error' | 'warning' | 'info';

export interface LintViolation {
  file: string;
  line?: number | undefined;
  what: string;
  rule: string;
  fix: string;
  severity: Severity;
}

export interface LintContext {
  projectRoot: string;
  files: string[];
}

export interface LintRule {
  name: string;
  description: string;
  run(context: LintContext): LintViolation[];
}

export interface LintResult {
  violations: LintViolation[];
  rulesRun: string[];
}

export function runRules(rules: LintRule[], context: LintContext): LintResult {
  const violations: LintViolation[] = [];
  const rulesRun: string[] = [];

  for (const rule of rules) {
    rulesRun.push(rule.name);
    const ruleViolations = rule.run(context);
    violations.push(...ruleViolations);
  }

  return { violations, rulesRun };
}

export function formatViolation(v: LintViolation): string {
  const location = v.line ? `${v.file}:${v.line}` : v.file;
  const prefix = v.severity === 'error' ? 'ERROR' : v.severity === 'warning' ? 'WARNING' : 'INFO';
  return `${prefix}: ${location}\n  What: ${v.what}\n  Rule: ${v.rule}\n  Fix: ${v.fix}`;
}

export function formatJson(result: LintResult): string {
  return JSON.stringify({
    violations: result.violations,
    summary: {
      total: result.violations.length,
      errors: result.violations.filter(v => v.severity === 'error').length,
      warnings: result.violations.filter(v => v.severity === 'warning').length,
      rulesRun: result.rulesRun,
    },
  }, null, 2);
}
