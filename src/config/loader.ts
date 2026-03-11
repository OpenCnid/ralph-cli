import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { RalphConfig, RawRalphConfig } from './schema.js';
import { DEFAULT_ARCHITECTURE, DEFAULT_DOCTOR, DEFAULT_GC, DEFAULT_HEAL, DEFAULT_PATHS, DEFAULT_QUALITY, DEFAULT_REFERENCES, DEFAULT_RUN, DEFAULT_REVIEW, DEFAULT_SCORING } from './defaults.js';
import { validate } from './validate.js';

const CONFIG_FILENAME = 'config.yml';
const CONFIG_DIR = '.ralph';

/**
 * Detect if running in a CI environment by checking common CI env vars.
 * Returns true if any recognized CI environment variable is set.
 */
export function detectCiEnvironment(): boolean {
  const ciVars = ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'CIRCLECI', 'JENKINS_URL', 'TRAVIS', 'BUILDKITE'];
  return ciVars.some(v => !!process.env[v]);
}

export interface LoadResult {
  config: RalphConfig;
  configPath: string | null;
  warnings: string[];
}

/**
 * Walk up from `startDir` looking for `.ralph/config.yml`.
 * Returns the path to the config file or null if not found.
 */
export function findConfigFile(startDir: string): string | null {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, CONFIG_DIR, CONFIG_FILENAME);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return null;
}

/**
 * Find the project root by looking for `.ralph/config.yml` or `.git/`.
 */
export function findProjectRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    if (existsSync(join(dir, CONFIG_DIR, CONFIG_FILENAME))) return dir;
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return startDir; // fallback to startDir
    dir = parent;
  }
}

/**
 * Merge raw parsed config with defaults to produce a fully-populated RalphConfig.
 */
export function mergeWithDefaults(raw: RawRalphConfig, isCi: boolean = false): RalphConfig {
  const config: RalphConfig = {
    project: {
      name: raw.project.name,
      language: raw.project.language,
      ...(raw.project.description !== undefined ? { description: raw.project.description } : {}),
      ...(raw.project.framework !== undefined ? { framework: raw.project.framework } : {}),
    },
    runner: raw.runner,
    architecture: {
      layers: raw.architecture?.layers ?? DEFAULT_ARCHITECTURE.layers,
      direction: raw.architecture?.direction ?? DEFAULT_ARCHITECTURE.direction,
      ...(raw.architecture?.domains !== undefined ? { domains: raw.architecture.domains } : {}),
      ...(raw.architecture?.['cross-cutting'] !== undefined ? { 'cross-cutting': raw.architecture['cross-cutting'] } : {}),
      rules: {
        'max-lines': raw.architecture?.rules?.['max-lines'] ?? DEFAULT_ARCHITECTURE.rules['max-lines'],
        naming: {
          // validated upstream — optional chaining is defensive, not necessary
          schemas: raw.architecture?.rules?.naming?.schemas ?? DEFAULT_ARCHITECTURE.rules.naming.schemas,
          types: raw.architecture?.rules?.naming?.types ?? DEFAULT_ARCHITECTURE.rules.naming.types,
        },
      },
    },
    quality: {
      'minimum-grade': raw.quality?.['minimum-grade'] ?? DEFAULT_QUALITY['minimum-grade'],
      coverage: {
        tool: raw.quality?.coverage?.tool ?? DEFAULT_QUALITY.coverage.tool,
        'report-path': raw.quality?.coverage?.['report-path'] ?? DEFAULT_QUALITY.coverage['report-path'],
      },
    },
    gc: {
      'consistency-threshold': raw.gc?.['consistency-threshold'] ?? DEFAULT_GC['consistency-threshold'],
      exclude: raw.gc?.exclude ?? DEFAULT_GC.exclude,
    },
    doctor: {
      'minimum-score': raw.doctor?.['minimum-score'] ?? DEFAULT_DOCTOR['minimum-score'],
      'custom-checks': raw.doctor?.['custom-checks'] ?? DEFAULT_DOCTOR['custom-checks'],
    },
    paths: {
      'agents-md': raw.paths?.['agents-md'] ?? DEFAULT_PATHS['agents-md'],
      'architecture-md': raw.paths?.['architecture-md'] ?? DEFAULT_PATHS['architecture-md'],
      docs: raw.paths?.docs ?? DEFAULT_PATHS.docs,
      specs: raw.paths?.specs ?? DEFAULT_PATHS.specs,
      plans: raw.paths?.plans ?? DEFAULT_PATHS.plans,
      'design-docs': raw.paths?.['design-docs'] ?? DEFAULT_PATHS['design-docs'],
      references: raw.paths?.references ?? DEFAULT_PATHS.references,
      generated: raw.paths?.generated ?? DEFAULT_PATHS.generated,
      quality: raw.paths?.quality ?? DEFAULT_PATHS.quality,
    },
    references: {
      'max-total-kb': raw.references?.['max-total-kb'] ?? DEFAULT_REFERENCES['max-total-kb'],
      'warn-single-file-kb': raw.references?.['warn-single-file-kb'] ?? DEFAULT_REFERENCES['warn-single-file-kb'],
    },
    ci: raw.ci,
    run: {
      agent: {
        cli: raw.run?.agent?.cli ?? DEFAULT_RUN.agent.cli,
        args: raw.run?.agent?.args ?? DEFAULT_RUN.agent.args,
        timeout: raw.run?.agent?.timeout ?? DEFAULT_RUN.agent.timeout,
      },
      // null and undefined are distinct: null = explicitly disabled, undefined = inherit default
      'plan-agent': raw.run?.['plan-agent'] === null
        ? null
        : raw.run?.['plan-agent'] !== undefined
          ? {
              cli: raw.run['plan-agent'].cli ?? DEFAULT_RUN.agent.cli,
              args: raw.run['plan-agent'].args ?? DEFAULT_RUN.agent.args,
              timeout: raw.run['plan-agent'].timeout ?? DEFAULT_RUN.agent.timeout,
            }
          : DEFAULT_RUN['plan-agent'],
      'build-agent': raw.run?.['build-agent'] === null
        ? null
        : raw.run?.['build-agent'] !== undefined
          ? {
              cli: raw.run['build-agent'].cli ?? DEFAULT_RUN.agent.cli,
              args: raw.run['build-agent'].args ?? DEFAULT_RUN.agent.args,
              timeout: raw.run['build-agent'].timeout ?? DEFAULT_RUN.agent.timeout,
            }
          : DEFAULT_RUN['build-agent'],
      prompts: {
        plan: raw.run?.prompts?.plan ?? DEFAULT_RUN.prompts.plan,
        build: raw.run?.prompts?.build ?? DEFAULT_RUN.prompts.build,
      },
      loop: {
        'max-iterations': raw.run?.loop?.['max-iterations'] ?? DEFAULT_RUN.loop['max-iterations'],
        'stall-threshold': raw.run?.loop?.['stall-threshold'] ?? DEFAULT_RUN.loop['stall-threshold'],
        'iteration-timeout': raw.run?.loop?.['iteration-timeout'] ?? DEFAULT_RUN.loop['iteration-timeout'],
      },
      validation: {
        'test-command': raw.run?.validation?.['test-command'] ?? DEFAULT_RUN.validation['test-command'],
        'typecheck-command': raw.run?.validation?.['typecheck-command'] ?? DEFAULT_RUN.validation['typecheck-command'],
      },
      git: {
        'auto-commit': raw.run?.git?.['auto-commit'] ?? DEFAULT_RUN.git['auto-commit'],
        'auto-push': raw.run?.git?.['auto-push'] ?? DEFAULT_RUN.git['auto-push'],
        'commit-prefix': raw.run?.git?.['commit-prefix'] ?? DEFAULT_RUN.git['commit-prefix'],
        branch: raw.run?.git?.branch ?? DEFAULT_RUN.git.branch,
      },
    },
    review: {
      // null and undefined are distinct: null = explicitly no agent (fall back to run.agent), undefined = inherit default
      agent: raw.review?.agent === null
        ? null
        : raw.review?.agent !== undefined
          ? {
              cli: raw.review.agent.cli ?? DEFAULT_REVIEW.agent?.cli ?? DEFAULT_RUN.agent.cli,
              args: raw.review.agent.args ?? DEFAULT_REVIEW.agent?.args ?? DEFAULT_RUN.agent.args,
              timeout: raw.review.agent.timeout ?? DEFAULT_REVIEW.agent?.timeout ?? DEFAULT_RUN.agent.timeout,
            }
          : DEFAULT_REVIEW.agent,
      scope: raw.review?.scope ?? DEFAULT_REVIEW.scope,
      context: {
        'include-specs': raw.review?.context?.['include-specs'] ?? DEFAULT_REVIEW.context['include-specs'],
        'include-architecture': raw.review?.context?.['include-architecture'] ?? DEFAULT_REVIEW.context['include-architecture'],
        'include-diff-context': raw.review?.context?.['include-diff-context'] ?? DEFAULT_REVIEW.context['include-diff-context'],
        'max-diff-lines': raw.review?.context?.['max-diff-lines'] ?? DEFAULT_REVIEW.context['max-diff-lines'],
      },
      output: {
        format: raw.review?.output?.format ?? DEFAULT_REVIEW.output.format,
        file: raw.review?.output?.file ?? DEFAULT_REVIEW.output.file,
        'severity-threshold': raw.review?.output?.['severity-threshold'] ?? DEFAULT_REVIEW.output['severity-threshold'],
      },
    },
    heal: {
      agent: raw.heal?.agent === null
        ? null
        : raw.heal?.agent !== undefined
          ? {
              cli: raw.heal.agent.cli ?? DEFAULT_RUN.agent.cli,
              args: raw.heal.agent.args ?? DEFAULT_RUN.agent.args,
              timeout: raw.heal.agent.timeout ?? DEFAULT_RUN.agent.timeout,
            }
          : DEFAULT_HEAL.agent,
      commands: raw.heal?.commands ?? DEFAULT_HEAL.commands,
      'auto-commit': raw.heal?.['auto-commit'] ?? DEFAULT_HEAL['auto-commit'],
      'commit-prefix': raw.heal?.['commit-prefix'] ?? DEFAULT_HEAL['commit-prefix'],
    },
    scoring: raw.scoring !== undefined ? {
      script: raw.scoring.script ?? DEFAULT_SCORING.script,
      'regression-threshold': raw.scoring['regression-threshold'] ?? DEFAULT_SCORING['regression-threshold'],
      'cumulative-threshold': raw.scoring['cumulative-threshold'] ?? DEFAULT_SCORING['cumulative-threshold'],
      'auto-revert': raw.scoring['auto-revert'] ?? DEFAULT_SCORING['auto-revert'],
      'default-weights': {
        tests: raw.scoring['default-weights']?.tests ?? DEFAULT_SCORING['default-weights'].tests,
        coverage: raw.scoring['default-weights']?.coverage ?? DEFAULT_SCORING['default-weights'].coverage,
      },
    } : undefined,
  };

  // Apply CI overrides when running in CI
  if (isCi && raw.ci) {
    if (raw.ci.quality?.['minimum-grade']) {
      config.quality['minimum-grade'] = raw.ci.quality['minimum-grade'];
    }
    if (raw.ci.doctor?.['minimum-score'] !== undefined) {
      config.doctor['minimum-score'] = raw.ci.doctor['minimum-score'];
    }
  }

  return config;
}

/**
 * Load config from the filesystem.
 * Walks up from cwd to find `.ralph/config.yml`, parses YAML, validates, and merges with defaults.
 * If no config file is found, returns defaults with a warning.
 */
export function loadConfig(startDir?: string, isCi?: boolean): LoadResult {
  const cwd = startDir ?? process.cwd();
  const configPath = findConfigFile(cwd);
  const warnings: string[] = [];

  // Auto-detect CI environment when not explicitly specified
  const effectiveIsCi = isCi ?? detectCiEnvironment();

  if (!configPath) {
    warnings.push('No .ralph/config.yml found. Using defaults. Run `ralph init` to create one.');
    // Return a minimal default config
    const defaultConfig = mergeWithDefaults({
      project: { name: 'unknown', language: 'typescript' },
    }, effectiveIsCi);
    return { config: defaultConfig, configPath: null, warnings };
  }

  let content: string;
  try {
    content = readFileSync(configPath, 'utf-8');
  } catch (err) {
    throw new Error(`Failed to read config file ${configPath}: ${(err as Error).message}`);
  }

  let raw: unknown;
  try {
    raw = parseYaml(content);
  } catch (err) {
    throw new Error(`Invalid YAML in ${configPath}: ${(err as Error).message}`);
  }

  const validationResult = validate(raw);
  if (validationResult.errors.length > 0) {
    throw new Error(
      `Invalid config in ${configPath}:\n${validationResult.errors.map(e => `  - ${e}`).join('\n')}`
    );
  }
  warnings.push(...validationResult.warnings);

  const config = mergeWithDefaults(raw as RawRalphConfig, effectiveIsCi);
  return { config, configPath, warnings };
}
