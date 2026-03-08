import { join } from 'node:path';
import { statSync } from 'node:fs';
import { loadConfig, findProjectRoot } from '../../config/index.js';
import { success, warn, error, info } from '../../utils/index.js';
import { runRules, formatViolation, formatJson } from './engine.js';
import type { LintRule, LintContext, LintFixResult } from './engine.js';
import { collectFiles } from './files.js';
import { createDependencyDirectionRule } from './rules/dependency-direction.js';
import { createFileSizeRule } from './rules/file-size.js';
import { createNamingConventionRule } from './rules/naming-convention.js';
import { loadCustomRules } from './rules/custom-rules.js';
import { createDomainIsolationRule } from './rules/domain-isolation.js';
import { createFileOrganizationRule } from './rules/file-organization.js';

interface LintOptions {
  fix?: boolean | undefined;
  json?: boolean | undefined;
  rule?: string | undefined;
}

export function lintCommand(targetPath: string | undefined, options: LintOptions): void {
  const projectRoot = findProjectRoot(process.cwd());
  const { config, warnings } = loadConfig(projectRoot);

  for (const w of warnings) {
    if (!options.json) warn(w);
  }

  // Build rules list
  const allRules: LintRule[] = [
    createDependencyDirectionRule(config.architecture),
    createDomainIsolationRule(config.architecture.domains, config.architecture['cross-cutting']),
    createFileSizeRule(config.architecture.files['max-lines']),
    createNamingConventionRule(config.architecture.files.naming),
    createFileOrganizationRule(config.architecture.domains),
  ];

  // Load custom rules
  const customRules = loadCustomRules(join(projectRoot, '.ralph', 'rules'));
  allRules.push(...customRules);

  // Filter by --rule if specified
  const rules = options.rule
    ? allRules.filter(r => r.name === options.rule)
    : allRules;

  if (options.rule && rules.length === 0) {
    error(`Unknown rule: "${options.rule}". Available rules: ${allRules.map(r => r.name).join(', ')}`);
    process.exit(1);
  }

  // Collect files
  let files: string[];
  if (targetPath) {
    const fullPath = join(projectRoot, targetPath);
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        files = collectFiles(fullPath, { exclude: config.gc.exclude });
      } else {
        files = [fullPath];
      }
    } catch {
      error(`Path not found: ${targetPath}`);
      process.exit(1);
    }
  } else {
    files = collectFiles(projectRoot, { exclude: config.gc.exclude });
  }

  const context: LintContext = { projectRoot, files };

  // --fix: apply auto-fixes before reporting
  if (options.fix) {
    const allFixes: LintFixResult[] = [];
    for (const rule of rules) {
      if (rule.autofix) {
        const fixes = rule.autofix(context);
        allFixes.push(...fixes);
      }
    }

    if (allFixes.length > 0 && !options.json) {
      for (const f of allFixes) {
        success(`Fixed: ${f.file} — ${f.description}`);
      }
      console.log('');
    }

    // Re-run rules to report remaining violations
    const result = runRules(rules, context);

    if (options.json) {
      console.log(formatJson(result, allFixes));
    } else {
      if (result.violations.length === 0) {
        success(`All violations fixed (${allFixes.length} fix(es) applied, ${rules.length} rules, ${files.length} files)`);
      } else {
        for (const v of result.violations) {
          console.log('');
          console.log(formatViolation(v));
        }
        console.log('');
        info(`${result.violations.length} violation(s) remaining after ${allFixes.length} fix(es) (${rules.length} rules, ${files.length} files)`);
      }
    }

    const hasErrors = result.violations.some(v => v.severity === 'error');
    if (hasErrors) {
      process.exit(1);
    }
    return;
  }

  const result = runRules(rules, context);

  // Output
  if (options.json) {
    console.log(formatJson(result));
  } else {
    if (result.violations.length === 0) {
      success(`No violations found (${rules.length} rules, ${files.length} files)`);
    } else {
      for (const v of result.violations) {
        console.log('');
        console.log(formatViolation(v));
      }
      console.log('');
      info(`${result.violations.length} violation(s) found (${rules.length} rules, ${files.length} files)`);
    }
  }

  // Exit code
  const hasErrors = result.violations.some(v => v.severity === 'error');
  if (hasErrors) {
    process.exit(1);
  }
}
