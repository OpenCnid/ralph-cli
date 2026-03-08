/**
 * naming-convention rule — enforces naming patterns for schemas and types.
 *
 * Supports --fix: renames non-conforming Zod schema exports to match the
 * configured pattern (e.g., "UserData" → "UserDataSchema") and updates
 * references across the codebase.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { relative, join } from 'node:path';
import type { LintRule, LintViolation, LintContext, LintFixResult } from '../engine.js';
import type { FileNamingConfig } from '../../../config/schema.js';

function patternToRegex(pattern: string): RegExp {
  // Convert glob-like pattern to regex. e.g., "*Schema" -> /^\w+Schema$/
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\*', '\\w+');
  return new RegExp(`^${escaped}$`);
}

/**
 * Compute a new name that matches the pattern.
 * e.g., pattern "*Schema", name "UserData" → "UserDataSchema"
 */
function computeFixedName(name: string, pattern: string): string {
  const starIdx = pattern.indexOf('*');
  if (starIdx === -1) return name;
  const suffix = pattern.slice(starIdx + 1);
  if (suffix && name.endsWith(suffix)) return name;
  return name + suffix;
}

export function createNamingConventionRule(naming: FileNamingConfig): LintRule {
  const schemaRegex = patternToRegex(naming.schemas);
  const typeRegex = patternToRegex(naming.types);

  return {
    name: 'naming-convention',
    description: `Schemas must match "${naming.schemas}", types must match "${naming.types}".`,

    run(context: LintContext): LintViolation[] {
      const violations: LintViolation[] = [];

      for (const file of context.files) {
        if (!file.match(/\.(ts|tsx|js|jsx)$/)) continue;

        let content: string;
        try {
          content = readFileSync(file, 'utf-8');
        } catch {
          continue;
        }

        const lines = content.split('\n');
        const rel = relative(context.projectRoot, file).replace(/\\/g, '/');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;

          // Check for schema exports: export const/type/interface ... = z.object/z.string/etc
          // Look for Zod schema definitions that don't follow naming
          const zodMatch = line.match(/export\s+(?:const)\s+(\w+)\s*=\s*z\./);
          if (zodMatch?.[1] && !schemaRegex.test(zodMatch[1])) {
            const fixedName = computeFixedName(zodMatch[1], naming.schemas);
            violations.push({
              file: rel,
              line: i + 1,
              what: `"${zodMatch[1]}" does not follow schema naming convention "${naming.schemas}"`,
              rule: `Schema exports must match the pattern "${naming.schemas}".`,
              fix: `Rename "${zodMatch[1]}" to match the pattern, e.g., "${fixedName}".`,
              severity: 'error',
            });
          }

          // Check type/interface exports — enforce type naming convention
          const typeMatch = line.match(/export\s+(?:type|interface)\s+(\w+)/);
          if (typeMatch?.[1]) {
            const name = typeMatch[1];
            // Skip generic utility types (Props, State, Context) and single-word types
            // which are typically framework conventions, not domain types
            if (!typeRegex.test(name) && !schemaRegex.test(name)) {
              const fixedName = computeFixedName(name, naming.types);
              violations.push({
                file: rel,
                line: i + 1,
                what: `"${name}" does not follow type naming convention "${naming.types}"`,
                rule: `Exported types must match the pattern "${naming.types}".`,
                fix: `Rename "${name}" to match the pattern, e.g., "${fixedName}".`,
                severity: 'warning',
              });
            }
          }
        }
      }

      return violations;
    },

    autofix(context: LintContext): LintFixResult[] {
      const fixes: LintFixResult[] = [];
      // Collect all renames first: { file, oldName, newName }
      const renames: { absPath: string; oldName: string; newName: string }[] = [];

      for (const file of context.files) {
        if (!file.match(/\.(ts|tsx|js|jsx)$/)) continue;

        let content: string;
        try {
          content = readFileSync(file, 'utf-8');
        } catch {
          continue;
        }

        const lines = content.split('\n');

        for (const line of lines) {
          const zodMatch = line.match(/export\s+(?:const)\s+(\w+)\s*=\s*z\./);
          if (zodMatch?.[1] && !schemaRegex.test(zodMatch[1])) {
            const oldName = zodMatch[1];
            const newName = computeFixedName(oldName, naming.schemas);
            renames.push({ absPath: file, oldName, newName });
          }
        }
      }

      if (renames.length === 0) return fixes;

      // Apply renames: update declaring files and all references across the codebase
      for (const rename of renames) {
        const rel = relative(context.projectRoot, rename.absPath).replace(/\\/g, '/');
        const wordRegex = new RegExp(`\\b${rename.oldName}\\b`, 'g');

        // Update declaring file
        try {
          let content = readFileSync(rename.absPath, 'utf-8');
          content = content.replace(wordRegex, rename.newName);
          writeFileSync(rename.absPath, content);
          fixes.push({
            file: rel,
            description: `Renamed "${rename.oldName}" to "${rename.newName}"`,
          });
        } catch {
          continue;
        }

        // Update references in other files (import statements and usages)
        for (const file of context.files) {
          if (file === rename.absPath) continue;
          if (!file.match(/\.(ts|tsx|js|jsx)$/)) continue;

          try {
            const content = readFileSync(file, 'utf-8');
            if (!wordRegex.test(content)) continue;
            // Reset lastIndex since we used test() with a global regex
            wordRegex.lastIndex = 0;

            const updated = content.replace(wordRegex, rename.newName);
            if (updated !== content) {
              writeFileSync(file, updated);
              const refRel = relative(context.projectRoot, file).replace(/\\/g, '/');
              fixes.push({
                file: refRel,
                description: `Updated references: "${rename.oldName}" → "${rename.newName}"`,
              });
            }
          } catch {
            continue;
          }
        }
      }

      return fixes;
    },
  };
}
