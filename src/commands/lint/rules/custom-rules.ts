/**
 * Custom rules — loads .ralph/rules/*.yml declarative rule files
 * and .ralph/rules/*.js script-based rules.
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
 *
 * Script format (.js):
 *   Executed with `node <script>`. Receives JSON on stdin:
 *     { "projectRoot": "...", "files": ["..."] }
 *   Must output JSON to stdout:
 *     { "name": "rule-name", "description": "...", "violations": [
 *       { "file": "...", "line": 1, "what": "...", "rule": "...", "fix": "...", "severity": "error" }
 *     ]}
 */

import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { LintRule, LintViolation, LintContext, Severity, LintFixResult } from '../engine.js';

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
  autofix?: {
    replace: string;
  };
}

function isValidSeverity(s: unknown): s is Severity {
  return s === 'error' || s === 'warning' || s === 'info';
}

export const customRulesRuntime = {
  execFileSync,
};

export function loadCustomRules(rulesDir: string): LintRule[] {
  if (!existsSync(rulesDir)) return [];

  const allFiles = readdirSync(rulesDir);
  const yamlFiles = allFiles.filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
  const scriptFiles = allFiles.filter(f => f.endsWith('.js') || f.endsWith('.sh'));
  const rules: LintRule[] = [];

  // Load script-based rules
  for (const scriptFile of scriptFiles) {
    const scriptPath = join(rulesDir, scriptFile);
    const scriptName = scriptFile.replace(/\.[^.]+$/, '');
    rules.push({
      name: scriptName,
      description: `Custom script rule: ${scriptFile}`,
      run(context: LintContext): LintViolation[] {
        try {
          const input = JSON.stringify({
            projectRoot: context.projectRoot,
            files: context.files,
          });
          const output = customRulesRuntime.execFileSync(process.execPath, [scriptPath], {
            cwd: context.projectRoot,
            encoding: 'utf-8',
            input,
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 30000,
          });
          const result = JSON.parse(output.trim()) as {
            name?: string;
            description?: string;
            violations?: Array<{
              file: string;
              line: number;
              what: string;
              rule: string;
              fix: string;
              severity?: string;
            }>;
          };
          if (!result.violations || !Array.isArray(result.violations)) return [];
          return result.violations.map(v => ({
            file: v.file,
            line: v.line ?? 0,
            what: v.what ?? 'Script rule violation',
            rule: v.rule ?? result.name ?? scriptName,
            fix: v.fix ?? '',
            severity: (isValidSeverity(v.severity) ? v.severity : 'error') as Severity,
          }));
        } catch {
          return [];
        }
      },
    });
  }

  for (const file of yamlFiles) {
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

    const rule: LintRule = {
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
    };

    if (def.autofix?.replace !== undefined) {
      const autofixReplace = def.autofix.replace;
      rule.autofix = (context: LintContext): LintFixResult[] => {
        const fixes: LintFixResult[] = [];
        for (const sourceFile of context.files) {
          let fileContent: string;
          try {
            fileContent = readFileSync(sourceFile, 'utf-8');
          } catch {
            continue;
          }

          if (!pattern.test(fileContent)) continue;
          pattern.lastIndex = 0;
          const updatedContent = fileContent.replace(
            new RegExp(def.match.pattern, 'g'),
            autofixReplace,
          );

          if (updatedContent !== fileContent) {
            writeFileSync(sourceFile, updatedContent, 'utf-8');
            fixes.push({
              file: relative(context.projectRoot, sourceFile).replace(/\\/g, '/'),
              description: `Applied autofix: ${def.name}`,
            });
          }
        }
        return fixes;
      };
    }

    rules.push(rule);
  }

  return rules;
}
