/**
 * File scanner — collects files to lint, respecting exclusions.
 */

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.py'];
const DEFAULT_EXCLUDE = ['node_modules', 'dist', '.next', 'coverage', '.git', '.ralph'];

export function collectFiles(
  dir: string,
  options: { exclude?: string[]; extensions?: string[]; includeTests?: boolean } = {}
): string[] {
  const exclude = options.exclude ?? DEFAULT_EXCLUDE;
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS;
  const includeTests = options.includeTests ?? false;
  const files: string[] = [];

  function walk(currentDir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(currentDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (exclude.some(ex => entry === ex)) continue;

      const fullPath = join(currentDir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (stat.isFile() && extensions.some(ext => entry.endsWith(ext))) {
        // Skip test files for linting (unless includeTests is set)
        if (!includeTests && (entry.includes('.test.') || entry.includes('.spec.'))) continue;
        files.push(fullPath);
      }
    }
  }

  walk(dir);
  return files;
}
