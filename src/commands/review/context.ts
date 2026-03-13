import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { warn } from '../../utils/output.js';
import type { RalphConfig } from '../../config/schema.js';
import type { ReviewContext } from './types.js';

/**
 * Resolve git args and a human-readable scope label from target + options.
 * Implements all 6 scope cases from the spec table.
 */
export function resolveScope(
  target: string | undefined,
  scopeFlag: string | undefined,
  configScope: string,
): { gitArgs: string[]; scopeLabel: string } {
  // Explicit range in target (e.g. "abc..def")
  if (target && target.includes('..')) {
    return { gitArgs: [target], scopeLabel: target };
  }

  // Single SHA or "HEAD"
  if (target && !target.includes(' ')) {
    const ref = target === 'HEAD' ? 'HEAD' : target;
    return { gitArgs: [`${ref}~1..${ref}`], scopeLabel: `${ref}~1..${ref}` };
  }

  // Determine scope from flag or config
  const scope = scopeFlag ?? configScope;

  if (scope === 'staged') {
    return { gitArgs: ['--cached'], scopeLabel: 'staged changes' };
  }
  if (scope === 'working') {
    return { gitArgs: [], scopeLabel: 'working tree changes' };
  }
  if (scope === 'commit') {
    return { gitArgs: ['HEAD~1..HEAD'], scopeLabel: 'HEAD~1..HEAD' };
  }
  if (scope === 'range') {
    throw new Error('Specify a range like abc..def when using --scope range.');
  }

  // Default fallback: staged
  return { gitArgs: ['--cached'], scopeLabel: 'staged changes' };
}

/**
 * Run git diff and return the diff text, stat, changed files, and binary file count.
 */
export function extractDiff(
  gitArgs: string[],
  contextLines: number,
): { diff: string; diffStat: string; changedFiles: string[]; binaryCount: number } {
  const argsStr = gitArgs.join(' ');
  let diff = '';
  let diffStat = '';
  let binaryCount = 0;

  try {
    diff = execSync(`git diff --unified=${contextLines} ${argsStr}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e: unknown) {
    const err = e as { message?: string; stderr?: Buffer };
    const msg = err.stderr?.toString() ?? err.message ?? '';
    if (msg.includes('not a git repository')) {
      throw new Error('Not a git repository. `ralph review` requires git.');
    }
    diff = '';
  }

  try {
    diffStat = execSync(`git diff --stat ${argsStr}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    diffStat = '';
  }

  // Count binary files from diff output
  const binaryMatches = diff.match(/^Binary files .* differ$/mg) ?? [];
  binaryCount = binaryMatches.length;

  // Remove binary file lines from diff
  diff = diff
    .split('\n')
    .filter((line) => !/^Binary files .* differ$/.test(line))
    .join('\n');

  // Parse changed files from stat output (lines like "  path/to/file.ts | 5 ++--")
  const changedFiles: string[] = [];
  for (const line of diffStat.split('\n')) {
    const match = /^\s+(.+?)\s+\|/.exec(line);
    if (match?.[1]) {
      changedFiles.push(match[1].trim());
    }
  }

  return { diff, diffStat, changedFiles, binaryCount };
}

/**
 * Find spec files relevant to the changed files.
 * Extracts first path components and fuzzy-matches against spec filenames.
 * Returns up to 3 most relevant spec file paths.
 */
export function findRelevantSpecs(changedFiles: string[], specsDir: string): string[] {
  if (!existsSync(specsDir)) return [];

  // Extract domain names from changed file paths
  const domains = new Set<string>();
  for (const file of changedFiles) {
    const parts = file.replace(/\\/g, '/').split('/');
    // Find meaningful directory: skip 'src', 'commands', top-level
    for (const part of parts) {
      if (part && part !== 'src' && part !== 'commands' && !part.includes('.')) {
        domains.add(part.toLowerCase());
        break;
      }
    }
    // Also use file base name without extension
    const base = basename(file, '.ts').toLowerCase();
    if (base && base !== 'index' && base !== 'types') {
      domains.add(base);
    }
  }

  // Scan specs directory for markdown files
  let specFiles: string[] = [];
  try {
    specFiles = readdirSync(specsDir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => join(specsDir, f));
  } catch {
    return [];
  }

  // Score each spec by how many domain terms it matches
  const scored: { path: string; score: number }[] = [];
  for (const specPath of specFiles) {
    const specName = basename(specPath, '.md').toLowerCase();
    let score = 0;
    for (const domain of domains) {
      if (specName.includes(domain) || domain.includes(specName)) {
        score += domain === specName ? 3 : 1;
      }
    }
    if (score > 0) {
      scored.push({ path: specPath, score });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((s) => s.path);
}

/**
 * Assemble the full ReviewContext from config and diff data.
 */
export function assembleContext(
  config: RalphConfig,
  diff: string,
  diffStat: string,
  changedFiles: string[],
  options: { diffOnly: boolean; maxDiffLines: number; scope?: string | undefined },
): ReviewContext {
  const projectRoot = process.cwd();
  let architecture = '';
  const specs: string[] = [];
  let rules = '';

  if (!options.diffOnly) {
    // Load ARCHITECTURE.md
    if (config.review?.context?.['include-architecture'] !== false) {
      const archPath = join(projectRoot, config.paths['architecture-md']);
      try {
        architecture = readFileSync(archPath, 'utf-8');
      } catch {
        architecture = '';
      }
    }

    // Find and load relevant specs
    if (config.review?.context?.['include-specs'] !== false) {
      const specsDir = join(projectRoot, config.paths.specs);
      const relevantSpecPaths = findRelevantSpecs(changedFiles, specsDir);
      for (const specPath of relevantSpecPaths) {
        try {
          specs.push(readFileSync(specPath, 'utf-8'));
        } catch {
          // skip unreadable spec
        }
      }
    }

    // Load AGENTS.md rules section
    const agentsMdPath = join(projectRoot, config.paths['agents-md']);
    try {
      const agentsMd = readFileSync(agentsMdPath, 'utf-8');
      // Extract from a "rules" heading onwards
      const rulesMatch = /^#+\s+.*rules.*$/im.exec(agentsMd);
      if (rulesMatch) {
        rules = agentsMd.slice(rulesMatch.index);
      }
    } catch {
      rules = '';
    }
  }

  // Truncate diff at maxDiffLines with warning
  const diffLines = diff.split('\n');
  let truncatedDiff = diff;
  if (diffLines.length > options.maxDiffLines) {
    truncatedDiff = diffLines.slice(0, options.maxDiffLines).join('\n');
    warn(`Diff truncated at ${options.maxDiffLines} lines. Review may be incomplete.`);
  }

  return {
    diff: truncatedDiff,
    diffStat,
    changedFiles,
    architecture,
    specs,
    rules,
    projectName: config.project.name,
    scope: options.scope ?? 'unknown',
    motivations: [],
  };
}
