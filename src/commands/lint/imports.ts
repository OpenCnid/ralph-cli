/**
 * Import parser — extracts import paths from TS/JS/Python files.
 * Used by dependency-direction rule to detect layer violations.
 */

import { readFileSync } from 'node:fs';

export interface ImportStatement {
  source: string;      // the import path
  line: number;        // 1-indexed line number
}

/**
 * Parse import statements from a TypeScript/JavaScript file.
 * Handles: import ... from '...', import('...'), require('...')
 */
export function parseImports(filePath: string): ImportStatement[] {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  const imports: ImportStatement[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNum = i + 1;

    // ES module imports: import ... from '...' or import ... from "..."
    const esImportMatch = line.match(/from\s+['"]([^'"]+)['"]/);
    if (esImportMatch?.[1]) {
      imports.push({ source: esImportMatch[1], line: lineNum });
      continue;
    }

    // Side-effect imports: import '...' or import "..."
    const sideEffectMatch = line.match(/^\s*import\s+['"]([^'"]+)['"]/);
    if (sideEffectMatch?.[1]) {
      imports.push({ source: sideEffectMatch[1], line: lineNum });
      continue;
    }

    // Dynamic imports: import('...')
    const dynamicMatch = line.match(/import\(\s*['"]([^'"]+)['"]\s*\)/);
    if (dynamicMatch?.[1]) {
      imports.push({ source: dynamicMatch[1], line: lineNum });
      continue;
    }

    // CommonJS: require('...')
    const requireMatch = line.match(/require\(\s*['"]([^'"]+)['"]\s*\)/);
    if (requireMatch?.[1]) {
      imports.push({ source: requireMatch[1], line: lineNum });
      continue;
    }

    // Python imports: from ... import ... or import ...
    const pythonFromMatch = line.match(/^\s*from\s+(\S+)\s+import/);
    if (pythonFromMatch?.[1]) {
      imports.push({ source: pythonFromMatch[1], line: lineNum });
      continue;
    }

    const pythonImportMatch = line.match(/^\s*import\s+(\S+)/);
    if (pythonImportMatch?.[1] && !line.includes('from')) {
      imports.push({ source: pythonImportMatch[1], line: lineNum });
    }
  }

  return imports;
}
