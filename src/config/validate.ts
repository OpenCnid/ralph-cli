/**
 * Config validation — checks structure and values, producing errors and warnings.
 * Runs in under 100ms as required by spec.
 */

const VALID_LANGUAGES = ['typescript', 'javascript', 'python', 'go', 'rust', 'multi'];
const VALID_RUNNERS = ['codex', 'claude', 'amp', 'aider', 'cursor', 'other'];
const VALID_COVERAGE_TOOLS = ['vitest', 'jest', 'pytest', 'go-test', 'none'];
const VALID_GRADES = ['A', 'B', 'C', 'D', 'F'];

const KNOWN_TOP_KEYS = ['project', 'runner', 'architecture', 'quality', 'gc', 'doctor', 'paths', 'references', 'ci'];
const KNOWN_PROJECT_KEYS = ['name', 'language', 'description', 'framework'];
const KNOWN_RUNNER_KEYS = ['cli'];
const KNOWN_ARCHITECTURE_KEYS = ['layers', 'domains', 'cross-cutting', 'files'];
const KNOWN_FILES_KEYS = ['max-lines', 'naming'];
const KNOWN_NAMING_KEYS = ['schemas', 'types'];
const KNOWN_QUALITY_KEYS = ['minimum-grade', 'coverage'];
const KNOWN_COVERAGE_KEYS = ['tool', 'report-path'];
const KNOWN_GC_KEYS = ['consistency-threshold', 'exclude'];
const KNOWN_DOCTOR_KEYS = ['minimum-score', 'custom-checks'];
const KNOWN_PATHS_KEYS = ['agents-md', 'architecture-md', 'docs', 'specs', 'plans', 'design-docs', 'references', 'generated', 'quality'];
const KNOWN_REFERENCES_KEYS = ['max-total-kb', 'warn-single-file-kb'];
const KNOWN_CI_KEYS = ['quality', 'doctor'];

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

function warnUnknownKeys(
  obj: Record<string, unknown>,
  knownKeys: string[],
  prefix: string,
  warnings: string[],
): void {
  for (const key of Object.keys(obj)) {
    if (!knownKeys.includes(key)) {
      warnings.push(`Unknown config key "${prefix}${key}" — it will be ignored.`);
    }
  }
}

function validateStringArray(
  arr: unknown,
  fieldPath: string,
  errors: string[],
): boolean {
  if (!Array.isArray(arr)) {
    errors.push(`"${fieldPath}" must be an array.`);
    return false;
  }
  for (let i = 0; i < arr.length; i++) {
    if (typeof arr[i] !== 'string' || (arr[i] as string).length === 0) {
      errors.push(`"${fieldPath}[${i}]" must be a non-empty string.`);
    }
  }
  return true;
}

export function validate(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (raw === null || raw === undefined || typeof raw !== 'object') {
    errors.push('Config must be a YAML object. Fix: ensure the file starts with `project:` key.');
    return { errors, warnings };
  }

  const obj = raw as Record<string, unknown>;

  // Warn about unknown top-level keys
  warnUnknownKeys(obj, KNOWN_TOP_KEYS, '', warnings);

  // project (required)
  if (!obj['project'] || typeof obj['project'] !== 'object') {
    errors.push('Missing required "project" section. Fix: add `project:` with `name` and `language`.');
    return { errors, warnings };
  }

  const project = obj['project'] as Record<string, unknown>;
  warnUnknownKeys(project, KNOWN_PROJECT_KEYS, 'project.', warnings);

  if (!project['name'] || typeof project['name'] !== 'string') {
    errors.push('Missing required "project.name". Fix: add `name: "your-project"` under `project:`.');
  }
  if (!project['language'] || typeof project['language'] !== 'string') {
    errors.push('Missing required "project.language". Fix: add `language: typescript` under `project:`.');
  } else if (!VALID_LANGUAGES.includes(project['language'])) {
    errors.push(`Invalid "project.language": "${project['language']}". Valid values: ${VALID_LANGUAGES.join(', ')}.`);
  }
  if (project['description'] !== undefined && typeof project['description'] !== 'string') {
    errors.push('"project.description" must be a string.');
  }
  if (project['framework'] !== undefined && typeof project['framework'] !== 'string') {
    errors.push('"project.framework" must be a string.');
  }

  // runner (optional)
  if (obj['runner'] !== undefined) {
    if (typeof obj['runner'] !== 'object' || obj['runner'] === null) {
      errors.push('"runner" must be an object. Fix: `runner:\\n  cli: codex`');
    } else {
      const runner = obj['runner'] as Record<string, unknown>;
      warnUnknownKeys(runner, KNOWN_RUNNER_KEYS, 'runner.', warnings);
      if (runner['cli'] !== undefined && typeof runner['cli'] === 'string' && !VALID_RUNNERS.includes(runner['cli'])) {
        warnings.push(`Unknown "runner.cli": "${runner['cli']}". Known values: ${VALID_RUNNERS.join(', ')}.`);
      }
    }
  }

  // architecture (optional)
  if (obj['architecture'] !== undefined) {
    if (typeof obj['architecture'] !== 'object' || obj['architecture'] === null) {
      errors.push('"architecture" must be an object.');
    } else {
      const arch = obj['architecture'] as Record<string, unknown>;
      warnUnknownKeys(arch, KNOWN_ARCHITECTURE_KEYS, 'architecture.', warnings);

      // layers
      if (arch['layers'] !== undefined) {
        validateStringArray(arch['layers'], 'architecture.layers', errors);
      }

      // domains
      if (arch['domains'] !== undefined) {
        if (!Array.isArray(arch['domains'])) {
          errors.push('"architecture.domains" must be an array.');
        } else {
          for (let i = 0; i < arch['domains'].length; i++) {
            const domain = arch['domains'][i] as Record<string, unknown> | undefined;
            if (!domain || typeof domain !== 'object') {
              errors.push(`"architecture.domains[${i}]" must be an object with "name" and "path".`);
            } else {
              if (!domain['name'] || typeof domain['name'] !== 'string') {
                errors.push(`"architecture.domains[${i}].name" is required and must be a string.`);
              }
              if (!domain['path'] || typeof domain['path'] !== 'string') {
                errors.push(`"architecture.domains[${i}].path" is required and must be a string.`);
              }
            }
          }
        }
      }

      // cross-cutting
      if (arch['cross-cutting'] !== undefined) {
        validateStringArray(arch['cross-cutting'], 'architecture.cross-cutting', errors);
      }

      // files
      if (arch['files'] !== undefined) {
        if (typeof arch['files'] !== 'object' || arch['files'] === null) {
          errors.push('"architecture.files" must be an object.');
        } else {
          const files = arch['files'] as Record<string, unknown>;
          warnUnknownKeys(files, KNOWN_FILES_KEYS, 'architecture.files.', warnings);

          if (files['max-lines'] !== undefined && (typeof files['max-lines'] !== 'number' || files['max-lines'] < 1)) {
            errors.push('"architecture.files.max-lines" must be a positive number.');
          }

          // naming
          if (files['naming'] !== undefined) {
            if (typeof files['naming'] !== 'object' || files['naming'] === null) {
              errors.push('"architecture.files.naming" must be an object.');
            } else {
              const naming = files['naming'] as Record<string, unknown>;
              warnUnknownKeys(naming, KNOWN_NAMING_KEYS, 'architecture.files.naming.', warnings);
              if (naming['schemas'] !== undefined && typeof naming['schemas'] !== 'string') {
                errors.push('"architecture.files.naming.schemas" must be a string pattern (e.g. "*Schema").');
              }
              if (naming['types'] !== undefined && typeof naming['types'] !== 'string') {
                errors.push('"architecture.files.naming.types" must be a string pattern (e.g. "*Type").');
              }
            }
          }
        }
      }
    }
  }

  // quality (optional)
  if (obj['quality'] !== undefined) {
    if (typeof obj['quality'] !== 'object' || obj['quality'] === null) {
      errors.push('"quality" must be an object.');
    } else {
      const quality = obj['quality'] as Record<string, unknown>;
      warnUnknownKeys(quality, KNOWN_QUALITY_KEYS, 'quality.', warnings);

      if (quality['minimum-grade'] !== undefined && !VALID_GRADES.includes(quality['minimum-grade'] as string)) {
        errors.push(`Invalid "quality.minimum-grade": "${quality['minimum-grade']}". Valid values: ${VALID_GRADES.join(', ')}.`);
      }
      if (quality['coverage'] !== undefined) {
        if (typeof quality['coverage'] !== 'object' || quality['coverage'] === null) {
          errors.push('"quality.coverage" must be an object.');
        } else {
          const cov = quality['coverage'] as Record<string, unknown>;
          warnUnknownKeys(cov, KNOWN_COVERAGE_KEYS, 'quality.coverage.', warnings);
          if (cov['tool'] !== undefined && !VALID_COVERAGE_TOOLS.includes(cov['tool'] as string)) {
            errors.push(`Invalid "quality.coverage.tool": "${cov['tool']}". Valid values: ${VALID_COVERAGE_TOOLS.join(', ')}.`);
          }
          if (cov['report-path'] !== undefined && typeof cov['report-path'] !== 'string') {
            errors.push('"quality.coverage.report-path" must be a string.');
          }
        }
      }
    }
  }

  // doctor (optional)
  if (obj['doctor'] !== undefined) {
    if (typeof obj['doctor'] !== 'object' || obj['doctor'] === null) {
      errors.push('"doctor" must be an object.');
    } else {
      const doctor = obj['doctor'] as Record<string, unknown>;
      warnUnknownKeys(doctor, KNOWN_DOCTOR_KEYS, 'doctor.', warnings);

      if (doctor['minimum-score'] !== undefined) {
        const score = doctor['minimum-score'];
        if (typeof score !== 'number' || score < 0 || score > 10) {
          errors.push('"doctor.minimum-score" must be a number between 0 and 10.');
        }
      }
      if (doctor['custom-checks'] !== undefined) {
        validateStringArray(doctor['custom-checks'], 'doctor.custom-checks', errors);
      }
    }
  }

  // gc (optional)
  if (obj['gc'] !== undefined) {
    if (typeof obj['gc'] !== 'object' || obj['gc'] === null) {
      errors.push('"gc" must be an object.');
    } else {
      const gc = obj['gc'] as Record<string, unknown>;
      warnUnknownKeys(gc, KNOWN_GC_KEYS, 'gc.', warnings);

      if (gc['consistency-threshold'] !== undefined) {
        const threshold = gc['consistency-threshold'];
        if (typeof threshold !== 'number' || threshold < 0 || threshold > 100) {
          errors.push('"gc.consistency-threshold" must be a number between 0 and 100.');
        }
      }
      if (gc['exclude'] !== undefined) {
        validateStringArray(gc['exclude'], 'gc.exclude', errors);
      }
    }
  }

  // paths (optional)
  if (obj['paths'] !== undefined) {
    if (typeof obj['paths'] !== 'object' || obj['paths'] === null) {
      errors.push('"paths" must be an object.');
    } else {
      const paths = obj['paths'] as Record<string, unknown>;
      warnUnknownKeys(paths, KNOWN_PATHS_KEYS, 'paths.', warnings);
      for (const key of KNOWN_PATHS_KEYS) {
        if (paths[key] !== undefined && typeof paths[key] !== 'string') {
          errors.push(`"paths.${key}" must be a string.`);
        }
      }
    }
  }

  // references (optional)
  if (obj['references'] !== undefined) {
    if (typeof obj['references'] !== 'object' || obj['references'] === null) {
      errors.push('"references" must be an object.');
    } else {
      const refs = obj['references'] as Record<string, unknown>;
      warnUnknownKeys(refs, KNOWN_REFERENCES_KEYS, 'references.', warnings);
      if (refs['max-total-kb'] !== undefined) {
        if (typeof refs['max-total-kb'] !== 'number' || refs['max-total-kb'] < 1) {
          errors.push('"references.max-total-kb" must be a positive number.');
        }
      }
      if (refs['warn-single-file-kb'] !== undefined) {
        if (typeof refs['warn-single-file-kb'] !== 'number' || refs['warn-single-file-kb'] < 1) {
          errors.push('"references.warn-single-file-kb" must be a positive number.');
        }
      }
    }
  }

  // ci (optional)
  if (obj['ci'] !== undefined) {
    if (typeof obj['ci'] !== 'object' || obj['ci'] === null) {
      errors.push('"ci" must be an object.');
    } else {
      const ci = obj['ci'] as Record<string, unknown>;
      warnUnknownKeys(ci, KNOWN_CI_KEYS, 'ci.', warnings);
    }
  }

  return { errors, warnings };
}
