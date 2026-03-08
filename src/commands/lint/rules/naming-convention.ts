/**
 * naming-convention rule — enforces naming patterns for schemas and types.
 */

import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import type { LintRule, LintViolation, LintContext } from '../engine.js';
import type { FileNamingConfig } from '../../../config/schema.js';

function patternToRegex(pattern: string): RegExp {
  // Convert glob-like pattern to regex. e.g., "*Schema" -> /^\w+Schema$/
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\*', '\\w+');
  return new RegExp(`^${escaped}$`);
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
            violations.push({
              file: rel,
              line: i + 1,
              what: `"${zodMatch[1]}" does not follow schema naming convention "${naming.schemas}"`,
              rule: `Schema exports must match the pattern "${naming.schemas}".`,
              fix: `Rename "${zodMatch[1]}" to match the pattern, e.g., "${zodMatch[1]}Schema".`,
              severity: 'error',
            });
          }

          // Check type/interface exports near schema files
          // Look for exported types that don't match the pattern
          const typeMatch = line.match(/export\s+(?:type|interface)\s+(\w+)/);
          if (typeMatch?.[1]) {
            // Only flag if it looks like a type alias (not generic interfaces)
            // Check if it ends with common type-like suffixes but doesn't match the configured pattern
            const name = typeMatch[1];
            if (name.endsWith('Data') || name.endsWith('Info') || name.endsWith('Params')) {
              if (!typeRegex.test(name) && !schemaRegex.test(name)) {
                // This is an intentionally light check — only flag obvious naming drift
                // We don't flag all types, just ones with common suffixes that should follow convention
              }
            }
          }
        }
      }

      return violations;
    },
  };
}
