/**
 * Config validation — checks structure and values, producing errors and warnings.
 * Runs in under 100ms as required by spec.
 */

const VALID_LANGUAGES = ['typescript', 'javascript', 'python', 'go', 'rust', 'multi'];
const VALID_RUNNERS = ['codex', 'claude', 'amp', 'aider', 'cursor', 'other'];
const VALID_COVERAGE_TOOLS = ['vitest', 'jest', 'pytest', 'go-test', 'none'];
const VALID_GRADES = ['A', 'B', 'C', 'D', 'F'];

const KNOWN_TOP_KEYS = ['project', 'runner', 'architecture', 'quality', 'gc', 'doctor', 'paths', 'references', 'ci'];

export interface ValidationResult {
  errors: string[];
  warnings: string[];
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
  for (const key of Object.keys(obj)) {
    if (!KNOWN_TOP_KEYS.includes(key)) {
      warnings.push(`Unknown config key "${key}" — it will be ignored.`);
    }
  }

  // project (required)
  if (!obj['project'] || typeof obj['project'] !== 'object') {
    errors.push('Missing required "project" section. Fix: add `project:` with `name` and `language`.');
    return { errors, warnings };
  }

  const project = obj['project'] as Record<string, unknown>;
  if (!project['name'] || typeof project['name'] !== 'string') {
    errors.push('Missing required "project.name". Fix: add `name: "your-project"` under `project:`.');
  }
  if (!project['language'] || typeof project['language'] !== 'string') {
    errors.push('Missing required "project.language". Fix: add `language: typescript` under `project:`.');
  } else if (!VALID_LANGUAGES.includes(project['language'])) {
    errors.push(`Invalid "project.language": "${project['language']}". Valid values: ${VALID_LANGUAGES.join(', ')}.`);
  }

  // runner (optional)
  if (obj['runner'] !== undefined) {
    if (typeof obj['runner'] !== 'object' || obj['runner'] === null) {
      errors.push('"runner" must be an object. Fix: `runner:\\n  cli: codex`');
    } else {
      const runner = obj['runner'] as Record<string, unknown>;
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
      if (arch['layers'] !== undefined && !Array.isArray(arch['layers'])) {
        errors.push('"architecture.layers" must be an array. Fix: use list format `- types\\n  - config`');
      }
      if (arch['files'] !== undefined && typeof arch['files'] === 'object' && arch['files'] !== null) {
        const files = arch['files'] as Record<string, unknown>;
        if (files['max-lines'] !== undefined && (typeof files['max-lines'] !== 'number' || files['max-lines'] < 1)) {
          errors.push('"architecture.files.max-lines" must be a positive number.');
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
      if (quality['minimum-grade'] !== undefined && !VALID_GRADES.includes(quality['minimum-grade'] as string)) {
        errors.push(`Invalid "quality.minimum-grade": "${quality['minimum-grade']}". Valid values: ${VALID_GRADES.join(', ')}.`);
      }
      if (quality['coverage'] !== undefined && typeof quality['coverage'] === 'object' && quality['coverage'] !== null) {
        const cov = quality['coverage'] as Record<string, unknown>;
        if (cov['tool'] !== undefined && !VALID_COVERAGE_TOOLS.includes(cov['tool'] as string)) {
          errors.push(`Invalid "quality.coverage.tool": "${cov['tool']}". Valid values: ${VALID_COVERAGE_TOOLS.join(', ')}.`);
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
      if (doctor['minimum-score'] !== undefined) {
        const score = doctor['minimum-score'];
        if (typeof score !== 'number' || score < 0 || score > 10) {
          errors.push('"doctor.minimum-score" must be a number between 0 and 10.');
        }
      }
    }
  }

  // gc (optional)
  if (obj['gc'] !== undefined) {
    if (typeof obj['gc'] !== 'object' || obj['gc'] === null) {
      errors.push('"gc" must be an object.');
    } else {
      const gc = obj['gc'] as Record<string, unknown>;
      if (gc['consistency-threshold'] !== undefined) {
        const threshold = gc['consistency-threshold'];
        if (typeof threshold !== 'number' || threshold < 0 || threshold > 100) {
          errors.push('"gc.consistency-threshold" must be a number between 0 and 100.');
        }
      }
    }
  }

  return { errors, warnings };
}
