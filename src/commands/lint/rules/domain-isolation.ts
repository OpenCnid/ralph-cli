/**
 * domain-isolation rule — enforces domain boundary isolation.
 *
 * Files within one domain cannot import from another domain.
 * Cross-cutting concerns are exempt.
 */

import { relative, dirname, join, normalize } from 'node:path';
import type { LintRule, LintViolation, LintContext } from '../engine.js';
import type { DomainConfig } from '../../../config/schema.js';
import { parseImports } from '../imports.js';

function resolveImportPath(importSource: string, importerDir: string, projectRoot: string): string | null {
  if (!importSource.startsWith('.')) return null;
  const resolved = normalize(join(importerDir, importSource));
  return relative(projectRoot, resolved).replace(/\\/g, '/');
}

function findDomain(filePath: string, domains: DomainConfig[], projectRoot: string): DomainConfig | null {
  const rel = relative(projectRoot, filePath).replace(/\\/g, '/');
  for (const domain of domains) {
    const domainPath = domain.path.replace(/\\/g, '/');
    if (rel.startsWith(domainPath + '/') || rel === domainPath) {
      return domain;
    }
  }
  return null;
}

function isInCrossCutting(relPath: string, crossCutting: string[]): boolean {
  return crossCutting.some(cc => {
    const ccNorm = cc.replace(/\\/g, '/');
    return relPath.startsWith(ccNorm + '/') || relPath === ccNorm;
  });
}

export function createDomainIsolationRule(
  domains: DomainConfig[] | undefined,
  crossCutting: string[] | undefined,
): LintRule {
  return {
    name: 'domain-isolation',
    description: 'Files within one domain cannot import from another domain.',

    run(context: LintContext): LintViolation[] {
      if (!domains || domains.length === 0) return [];

      const violations: LintViolation[] = [];
      const cc = crossCutting ?? [];

      for (const file of context.files) {
        const sourceDomain = findDomain(file, domains, context.projectRoot);
        if (!sourceDomain) continue; // file not in any domain

        const imports = parseImports(file);
        for (const imp of imports) {
          if (!imp.source.startsWith('.')) continue;

          const resolvedPath = resolveImportPath(imp.source, dirname(file), context.projectRoot);
          if (!resolvedPath) continue;

          // Cross-cutting concerns are allowed
          if (isInCrossCutting(resolvedPath, cc)) continue;

          const targetDomain = findDomain(
            join(context.projectRoot, resolvedPath),
            domains,
            context.projectRoot,
          );
          if (!targetDomain) continue; // target not in any domain
          if (targetDomain.name === sourceDomain.name) continue; // same domain

          const rel = relative(context.projectRoot, file).replace(/\\/g, '/');
          violations.push({
            file: rel,
            line: imp.line,
            what: `${rel} (domain "${sourceDomain.name}") imports from ${imp.source} (domain "${targetDomain.name}")`,
            rule: `Domain "${sourceDomain.name}" cannot import from domain "${targetDomain.name}". Domains must be isolated — share code via cross-cutting concerns.`,
            fix: `Move the shared code to a cross-cutting concern directory (e.g., ${cc[0] ?? 'src/shared'}) or remove the cross-domain dependency.`,
            severity: 'error',
          });
        }
      }

      return violations;
    },
  };
}
