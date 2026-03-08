/**
 * dependency-direction rule — enforces forward-only layer imports.
 *
 * Each layer can only import from layers above it in the configured list.
 * Cross-cutting concerns are exempt.
 */

import { relative, dirname, join, normalize } from 'node:path';
import type { LintRule, LintViolation, LintContext } from '../engine.js';
import type { ArchitectureConfig } from '../../../config/schema.js';
import { parseImports } from '../imports.js';

function resolveImportPath(importSource: string, importerDir: string, projectRoot: string): string | null {
  // Only handle relative imports
  if (!importSource.startsWith('.')) return null;

  const resolved = normalize(join(importerDir, importSource));
  return relative(projectRoot, resolved);
}

function getLayerIndex(filePath: string, layers: string[], projectRoot: string): number {
  const rel = relative(projectRoot, filePath).replace(/\\/g, '/');
  for (let i = 0; i < layers.length; i++) {
    // Check if the file path contains the layer name as a directory segment
    const layer = layers[i]!;
    const segments = rel.split('/');
    if (segments.some(s => s === layer)) {
      return i;
    }
  }
  return -1;
}

function isInCrossCutting(filePath: string, crossCutting: string[], projectRoot: string): boolean {
  const rel = relative(projectRoot, filePath).replace(/\\/g, '/');
  return crossCutting.some(cc => rel.startsWith(cc.replace(/\\/g, '/')));
}

export function createDependencyDirectionRule(architecture: ArchitectureConfig): LintRule {
  const direction = architecture.direction;
  return {
    name: 'dependency-direction',
    description: `Enforces ${direction} layer imports: each layer can only import from layers above it.`,

    run(context: LintContext): LintViolation[] {
      const violations: LintViolation[] = [];
      const { layers } = architecture;
      const crossCutting = architecture['cross-cutting'] ?? [];

      for (const file of context.files) {
        const sourceLayer = getLayerIndex(file, layers, context.projectRoot);
        if (sourceLayer === -1) continue; // file not in any layer

        const imports = parseImports(file);
        for (const imp of imports) {
          if (!imp.source.startsWith('.')) continue; // skip external imports

          const resolvedPath = resolveImportPath(imp.source, dirname(file), context.projectRoot);
          if (!resolvedPath) continue;

          // Skip cross-cutting concerns
          if (isInCrossCutting(resolvedPath, crossCutting, context.projectRoot)) continue;

          const targetLayer = getLayerIndex(resolvedPath, layers, context.projectRoot);
          if (targetLayer === -1) continue; // target not in any layer

          // Violation: importing from a layer below (higher index = deeper layer)
          if (targetLayer > sourceLayer) {
            const sourceLayerName = layers[sourceLayer]!;
            const targetLayerName = layers[targetLayer]!;
            const rel = relative(context.projectRoot, file).replace(/\\/g, '/');

            violations.push({
              file: rel,
              line: imp.line,
              what: `${rel} (${sourceLayerName} layer) imports from ${imp.source} (${targetLayerName} layer)`,
              rule: `Layer "${sourceLayerName}" cannot import from "${targetLayerName}". Dependency direction is ${direction}: ${layers.join(' → ')}.`,
              fix: `Move the imported code to the "${sourceLayerName}" layer or a higher layer, or mark the import source as cross-cutting in config.`,
              severity: 'error',
            });
          }
        }
      }

      return violations;
    },
  };
}
