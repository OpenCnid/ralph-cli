/**
 * file-organization rule — detects business logic placed in utils/ directories.
 *
 * utils/ should contain generic, reusable utilities (formatters, validators, helpers).
 * Domain-specific business logic belongs in domain modules, not utils/.
 *
 * Heuristics:
 * 1. Files in utils/ that import from configured domain paths
 * 2. Files in utils/ whose names suggest domain operations (handle*, process*, manage*, etc.)
 * 3. Files in utils/ that contain class declarations (utilities tend to be pure functions)
 */

import { readFileSync } from 'node:fs';
import { relative, dirname, resolve } from 'node:path';
import type { LintRule, LintViolation, LintContext } from '../engine.js';
import type { DomainConfig } from '../../../config/schema.js';
import { parseImports } from '../imports.js';

/** Verb prefixes that suggest domain-specific business logic, not generic utilities. */
const BUSINESS_LOGIC_PREFIXES = [
  'handle', 'process', 'manage', 'execute', 'create', 'update', 'delete',
  'submit', 'validate', 'authorize', 'authenticate', 'checkout', 'invoice',
  'bill', 'charge', 'refund', 'transfer', 'notify', 'schedule', 'dispatch',
];

function isUtilsPath(relPath: string): boolean {
  const segments = relPath.split('/');
  return segments.some(s => s === 'utils' || s === 'util' || s === 'helpers');
}

function hasBusinessLogicName(fileName: string): boolean {
  // Strip extension and convert to lowercase
  const base = fileName.replace(/\.[^.]+$/, '').toLowerCase();
  return BUSINESS_LOGIC_PREFIXES.some(prefix => base.startsWith(prefix));
}

function containsClassDeclarations(content: string): boolean {
  return /^export\s+(default\s+)?class\s+\w+/m.test(content);
}

function importsDomainCode(
  filePath: string,
  projectRoot: string,
  domains: DomainConfig[],
): { importing: boolean; domainName?: string | undefined } {
  if (domains.length === 0) return { importing: false };

  const imports = parseImports(filePath);
  const fileDir = dirname(filePath);

  for (const imp of imports) {
    // Only check relative imports
    if (!imp.source.startsWith('.')) continue;

    // Resolve the import to an absolute path, then make it relative to project root
    const resolved = resolve(fileDir, imp.source).replace(/\.[^.]+$/, '');
    const relResolved = relative(projectRoot, resolved).replace(/\\/g, '/');

    for (const domain of domains) {
      if (relResolved.startsWith(domain.path)) {
        return { importing: true, domainName: domain.name };
      }
    }
  }

  return { importing: false };
}

export function createFileOrganizationRule(
  domains?: DomainConfig[] | undefined,
): LintRule {
  return {
    name: 'file-organization',
    description: 'utils/ directories should contain generic utilities, not domain-specific business logic.',

    run(context: LintContext): LintViolation[] {
      const violations: LintViolation[] = [];
      const configuredDomains = domains ?? [];

      for (const file of context.files) {
        const rel = relative(context.projectRoot, file).replace(/\\/g, '/');

        if (!isUtilsPath(rel)) continue;

        const fileName = rel.split('/').pop() ?? '';
        const reasons: string[] = [];

        // Check 1: File name suggests business logic
        if (hasBusinessLogicName(fileName)) {
          reasons.push(`file name "${fileName}" suggests domain-specific business logic`);
        }

        // Check 2: Imports from domain paths
        const domainImport = importsDomainCode(file, context.projectRoot, configuredDomains);
        if (domainImport.importing) {
          reasons.push(`imports from domain "${domainImport.domainName}"`);
        }

        // Check 3: Contains class declarations (utilities are typically functions)
        let content: string;
        try {
          content = readFileSync(file, 'utf-8');
        } catch {
          continue;
        }

        if (containsClassDeclarations(content)) {
          reasons.push('contains class declarations (utilities should be pure functions)');
        }

        if (reasons.length === 0) continue;

        // Build domain suggestion for the fix message
        let domainSuggestion = 'a domain module';
        if (domainImport.domainName) {
          const domainPath = configuredDomains.find(d => d.name === domainImport.domainName)?.path;
          domainSuggestion = domainPath ? `${domainPath}/` : `the "${domainImport.domainName}" domain`;
        }

        violations.push({
          file: rel,
          what: `${rel} contains business logic in a utils/ directory: ${reasons.join('; ')}`,
          rule: 'utils/ is for generic utilities, not domain logic.',
          fix: `Move to ${domainSuggestion} or create a new domain module.`,
          severity: 'error',
        });
      }

      return violations;
    },
  };
}
