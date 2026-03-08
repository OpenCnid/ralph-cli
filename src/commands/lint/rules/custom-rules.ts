/**
 * Custom rules — loads .ralph/rules/*.yml declarative rule files.
 *
 * YAML format:
 *   name: rule-name
 *   description: What this rule checks
 *   severity: error | warning | info
 *   match:
 *     pattern: regex pattern to search for
 *     require-nearby: regex that must appear within N lines
 *     within-lines: 5  (default)
 *   fix: How to fix violations
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { LintRule, LintViolation, LintContext, Severity } from '../engine.js';

interface CustomRuleDefinition {
  name: string;
  description: string;
  severity?: string;
  match: {
    pattern: string;
    'require-nearby'?: string;
    'within-lines'?: number;
  };
  fix: string;
}

function isValidSeverity(s: unknown): s is Severity {
  return s === 'error' || s === 'warning' || s === 'info';
}

export function loadCustomRules(rulesDir: string): LintRule[] {
  if (!existsSync(rulesDir)) return [];

  const files = readdirSync(rulesDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
  const rules: LintRule[] = [];

  for (const file of files) {
    const filePath = join(rulesDir, file);
    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    let def: CustomRuleDefinition;
    try {
      def = parseYaml(content) as CustomRuleDefinition;
    } catch {
      continue;
    }

    if (!def.name || !def.match?.pattern || !def.fix) continue;

    const severity: Severity = isValidSeverity(def.severity) ? def.severity : 'error';
    const withinLines = def.match['within-lines'] ?? 5;
    const pattern = new RegExp(def.match.pattern);
    const requireNearby = def.match['require-nearby'] ? new RegExp(def.match['require-nearby']) : null;

    rules.push({
      name: def.name,
      description: def.description ?? '',
      run(context: LintContext): LintViolation[] {
        const violations: LintViolation[] = [];

        for (const sourceFile of context.files) {
          let fileContent: string;
          try {
            fileContent = readFileSync(sourceFile, 'utf-8');
          } catch {
            continue;
          }

          const lines = fileContent.split('\n');
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]!;
            if (!pattern.test(line)) continue;

            if (requireNearby) {
              // Check if the required pattern exists within N lines
              const start = Math.max(0, i - withinLines);
              const end = Math.min(lines.length, i + withinLines + 1);
              const nearby = lines.slice(start, end).join('\n');
              if (requireNearby.test(nearby)) continue; // requirement met, no violation
            }

            const rel = relative(context.projectRoot, sourceFile).replace(/\\/g, '/');
            violations.push({
              file: rel,
              line: i + 1,
              what: `Pattern matched: ${line.trim()}`,
              rule: def.description ?? def.name,
              fix: def.fix,
              severity,
            });
          }
        }

        return violations;
      },
    });
  }

  return rules;
}
