import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { RalphConfig, RawRalphConfig } from './schema.js';
import { DEFAULT_ARCHITECTURE, DEFAULT_DOCTOR, DEFAULT_GC, DEFAULT_PATHS, DEFAULT_QUALITY, DEFAULT_REFERENCES } from './defaults.js';
import { validate } from './validate.js';

const CONFIG_FILENAME = 'config.yml';
const CONFIG_DIR = '.ralph';

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
      ...(raw.architecture?.domains !== undefined ? { domains: raw.architecture.domains } : {}),
      ...(raw.architecture?.['cross-cutting'] !== undefined ? { 'cross-cutting': raw.architecture['cross-cutting'] } : {}),
      files: {
        'max-lines': raw.architecture?.files?.['max-lines'] ?? DEFAULT_ARCHITECTURE.files['max-lines'],
        naming: {
          schemas: raw.architecture?.files?.naming?.schemas ?? DEFAULT_ARCHITECTURE.files.naming.schemas,
          types: raw.architecture?.files?.naming?.types ?? DEFAULT_ARCHITECTURE.files.naming.types,
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

  if (!configPath) {
    warnings.push('No .ralph/config.yml found. Using defaults. Run `ralph init` to create one.');
    // Return a minimal default config
    const defaultConfig = mergeWithDefaults({
      project: { name: 'unknown', language: 'typescript' },
    }, isCi);
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

  const config = mergeWithDefaults(raw as RawRalphConfig, isCi);
  return { config, configPath, warnings };
}
