/**
 * file-size rule — flags files exceeding the configured max-lines threshold.
 */

import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import type { LintRule, LintViolation, LintContext } from '../engine.js';

export function createFileSizeRule(maxLines: number): LintRule {
  return {
    name: 'file-size',
    description: `Files must not exceed ${maxLines} lines.`,

    run(context: LintContext): LintViolation[] {
      const violations: LintViolation[] = [];

      for (const file of context.files) {
        let content: string;
        try {
          content = readFileSync(file, 'utf-8');
        } catch {
          continue;
        }

        const lineCount = content.split('\n').length;
        if (lineCount > maxLines) {
          const rel = relative(context.projectRoot, file).replace(/\\/g, '/');
          violations.push({
            file: rel,
            what: `${rel} is ${lineCount} lines (limit: ${maxLines})`,
            rule: `Files over ${maxLines} lines indicate missing decomposition.`,
            fix: `Split into smaller, focused files. Consider extracting distinct responsibilities into separate modules.`,
            severity: 'warning',
          });
        }
      }

      return violations;
    },
  };
}
