/**
 * Domain-specific config validators.
 * Each function validates one top-level config section and pushes errors/warnings.
 */

// ── Valid values ──────────────────────────────────────────────────────────────

export const VALID_LANGUAGES = ['typescript', 'javascript', 'python', 'go', 'rust', 'multi'];
export const VALID_RUNNERS = ['codex', 'claude', 'amp', 'aider', 'cursor', 'other'];
export const VALID_COVERAGE_TOOLS = ['vitest', 'jest', 'pytest', 'go-test', 'none'];
export const VALID_GRADES = ['A', 'B', 'C', 'D', 'F'];
export const VALID_DIRECTIONS = ['forward-only'];
export const VALID_HEAL_COMMANDS = ['doctor', 'grade', 'gc', 'lint'];

// ── Known-key sets ───────────────────────────────────────────────────────────

export const KNOWN_TOP_KEYS = ['project', 'runner', 'architecture', 'quality', 'gc', 'doctor', 'paths', 'references', 'ci', 'run', 'review', 'heal', 'scoring', 'calibration'];
export const KNOWN_PROJECT_KEYS = ['name', 'language', 'description', 'framework'];
export const KNOWN_RUNNER_KEYS = ['cli'];
export const KNOWN_ARCHITECTURE_KEYS = ['layers', 'direction', 'domains', 'cross-cutting', 'rules'];
export const KNOWN_RULES_KEYS = ['max-lines', 'naming'];
export const KNOWN_NAMING_KEYS = ['schemas', 'types'];
export const KNOWN_QUALITY_KEYS = ['minimum-grade', 'coverage'];
export const KNOWN_COVERAGE_KEYS = ['tool', 'report-path'];
export const KNOWN_GC_KEYS = ['consistency-threshold', 'exclude', 'divergence'];
export const KNOWN_DIVERGENCE_KEYS = ['enabled', 'new-pattern-threshold', 'proportion-change-threshold'];
export const KNOWN_DOCTOR_KEYS = ['minimum-score', 'custom-checks'];
export const KNOWN_PATHS_KEYS = ['agents-md', 'architecture-md', 'docs', 'specs', 'plans', 'design-docs', 'references', 'generated', 'quality'];
export const KNOWN_REFERENCES_KEYS = ['max-total-kb', 'warn-single-file-kb'];
export const KNOWN_CI_KEYS = ['quality', 'doctor'];
export const KNOWN_RUN_KEYS = ['agent', 'plan-agent', 'build-agent', 'prompts', 'loop', 'validation', 'git', 'adversarial'];
export const KNOWN_ADVERSARIAL_KEYS = ['enabled', 'agent', 'model', 'budget', 'timeout', 'diagnostic-branch', 'test-patterns', 'restricted-patterns', 'skip-on-simplify'];
export const KNOWN_RUN_AGENT_KEYS = ['cli', 'args', 'timeout'];
export const KNOWN_RUN_PROMPTS_KEYS = ['plan', 'build'];
export const KNOWN_RUN_LOOP_KEYS = ['max-iterations', 'stall-threshold', 'iteration-timeout'];
export const KNOWN_RUN_VALIDATION_KEYS = ['test-command', 'typecheck-command', 'stages'];
export const KNOWN_RUN_GIT_KEYS = ['auto-commit', 'auto-push', 'commit-prefix', 'branch'];
export const KNOWN_SCORING_KEYS = ['script', 'regression-threshold', 'cumulative-threshold', 'auto-revert', 'default-weights'];
export const KNOWN_SCORING_WEIGHTS_KEYS = ['tests', 'coverage'];
export const KNOWN_HEAL_KEYS = ['agent', 'commands', 'auto-commit', 'commit-prefix'];
export const KNOWN_REVIEW_KEYS = ['agent', 'scope', 'context', 'output'];
export const KNOWN_REVIEW_CONTEXT_KEYS = ['include-specs', 'include-architecture', 'include-diff-context', 'max-diff-lines'];
export const KNOWN_REVIEW_OUTPUT_KEYS = ['format', 'file', 'severity-threshold'];
export const KNOWN_CALIBRATION_KEYS = ['window', 'warn-pass-rate', 'warn-discard-rate', 'warn-volatility'];

// ── Helpers ──────────────────────────────────────────────────────────────────

export function warnUnknownKeys(
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

export function validateStringArray(
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

export function validateAgentConfig(
  obj: Record<string, unknown>,
  prefix: string,
  errors: string[],
  warnings: string[],
): void {
  warnUnknownKeys(obj, KNOWN_RUN_AGENT_KEYS, `${prefix}.`, warnings);
  if (typeof obj['cli'] !== 'string' || obj['cli'].length === 0) {
    errors.push(`"${prefix}.cli" is required and must be a non-empty string.`);
  }
  if (obj['args'] !== undefined) {
    validateStringArray(obj['args'], `${prefix}.args`, errors);
  }
  if (obj['timeout'] !== undefined) {
    const t = obj['timeout'];
    if (typeof t !== 'number' || !Number.isInteger(t) || t <= 0) {
      errors.push(`"${prefix}.timeout" must be a positive integer.`);
    }
  }
}

// ── Domain validators ────────────────────────────────────────────────────────

export function validateProject(project: Record<string, unknown>, errors: string[], warnings: string[]): void {
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
}

export function validateRunner(runner: Record<string, unknown>, warnings: string[]): void {
  warnUnknownKeys(runner, KNOWN_RUNNER_KEYS, 'runner.', warnings);
  if (runner['cli'] !== undefined && typeof runner['cli'] === 'string' && !VALID_RUNNERS.includes(runner['cli'])) {
    warnings.push(`Unknown "runner.cli": "${runner['cli']}". Known values: ${VALID_RUNNERS.join(', ')}.`);
  }
}

export function validateArchitecture(arch: Record<string, unknown>, errors: string[], warnings: string[]): void {
  warnUnknownKeys(arch, KNOWN_ARCHITECTURE_KEYS, 'architecture.', warnings);
  if (arch['layers'] !== undefined) {
    validateStringArray(arch['layers'], 'architecture.layers', errors);
  }
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
  if (arch['cross-cutting'] !== undefined) {
    validateStringArray(arch['cross-cutting'], 'architecture.cross-cutting', errors);
  }
  if (arch['direction'] !== undefined) {
    if (typeof arch['direction'] !== 'string' || !VALID_DIRECTIONS.includes(arch['direction'])) {
      errors.push(`Invalid "architecture.direction": "${arch['direction']}". Valid values: ${VALID_DIRECTIONS.join(', ')}.`);
    }
  }
  if (arch['rules'] !== undefined) {
    if (typeof arch['rules'] !== 'object' || arch['rules'] === null) {
      errors.push('"architecture.rules" must be an object.');
    } else {
      const rules = arch['rules'] as Record<string, unknown>;
      warnUnknownKeys(rules, KNOWN_RULES_KEYS, 'architecture.rules.', warnings);
      if (rules['max-lines'] !== undefined && (typeof rules['max-lines'] !== 'number' || rules['max-lines'] < 1)) {
        errors.push('"architecture.rules.max-lines" must be a positive number.');
      }
      if (rules['naming'] !== undefined) {
        if (typeof rules['naming'] !== 'object' || rules['naming'] === null) {
          errors.push('"architecture.rules.naming" must be an object.');
        } else {
          const naming = rules['naming'] as Record<string, unknown>;
          warnUnknownKeys(naming, KNOWN_NAMING_KEYS, 'architecture.rules.naming.', warnings);
          if (naming['schemas'] !== undefined && typeof naming['schemas'] !== 'string') {
            errors.push('"architecture.rules.naming.schemas" must be a string pattern (e.g. "*Schema").');
          }
          if (naming['types'] !== undefined && typeof naming['types'] !== 'string') {
            errors.push('"architecture.rules.naming.types" must be a string pattern (e.g. "*Type").');
          }
        }
      }
    }
  }
}

export function validateQuality(quality: Record<string, unknown>, errors: string[], warnings: string[]): void {
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

export function validateDoctor(doctor: Record<string, unknown>, errors: string[], warnings: string[]): void {
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

export function validateGc(gc: Record<string, unknown>, errors: string[], warnings: string[]): void {
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
  if (gc['divergence'] !== undefined) {
    if (typeof gc['divergence'] !== 'object' || gc['divergence'] === null) {
      errors.push('"gc.divergence" must be an object.');
    } else {
      validateDivergenceConfig(gc['divergence'] as Record<string, unknown>, errors, warnings);
    }
  }
}

export function validateDivergenceConfig(div: Record<string, unknown>, errors: string[], warnings: string[]): void {
  warnUnknownKeys(div, KNOWN_DIVERGENCE_KEYS, 'gc.divergence.', warnings);
  if (div['enabled'] !== undefined && typeof div['enabled'] !== 'boolean') {
    errors.push('"gc.divergence.enabled" must be a boolean.');
  }
  if (div['new-pattern-threshold'] !== undefined) {
    const v = div['new-pattern-threshold'];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) {
      errors.push('"gc.divergence.new-pattern-threshold" must be an integer ≥ 1.');
    }
  }
  if (div['proportion-change-threshold'] !== undefined) {
    const v = div['proportion-change-threshold'];
    if (typeof v !== 'number' || v <= 0 || v >= 1) {
      errors.push('"gc.divergence.proportion-change-threshold" must be a number in the range (0.0, 1.0) exclusive.');
    }
  }
}

export function validatePaths(paths: Record<string, unknown>, errors: string[], warnings: string[]): void {
  warnUnknownKeys(paths, KNOWN_PATHS_KEYS, 'paths.', warnings);
  for (const key of KNOWN_PATHS_KEYS) {
    if (paths[key] !== undefined && typeof paths[key] !== 'string') {
      errors.push(`"paths.${key}" must be a string.`);
    }
  }
}

export function validateReferences(refs: Record<string, unknown>, errors: string[], warnings: string[]): void {
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

export function validateCi(ci: Record<string, unknown>, warnings: string[]): void {
  warnUnknownKeys(ci, KNOWN_CI_KEYS, 'ci.', warnings);
}

// Run-domain validators (validateRun, validateStages, validateAdversarialConfig)
// are in validate-run.ts to keep file sizes under the 600-line limit.

export function validateHealConfig(heal: Record<string, unknown>, errors: string[], warnings: string[]): void {
  warnUnknownKeys(heal, KNOWN_HEAL_KEYS, 'heal.', warnings);
  if (heal['agent'] !== undefined && heal['agent'] !== null) {
    if (typeof heal['agent'] !== 'object') {
      errors.push('"heal.agent" must be null or an object.');
    } else {
      validateAgentConfig(heal['agent'] as Record<string, unknown>, 'heal.agent', errors, warnings);
    }
  }
  if (heal['commands'] !== undefined) {
    if (!Array.isArray(heal['commands'])) {
      errors.push('"heal.commands" must be an array.');
    } else {
      for (let i = 0; i < heal['commands'].length; i++) {
        const cmd = heal['commands'][i];
        if (typeof cmd !== 'string' || !VALID_HEAL_COMMANDS.includes(cmd)) {
          errors.push(`"heal.commands[${i}]" must be one of: ${VALID_HEAL_COMMANDS.join(', ')}.`);
        }
      }
    }
  }
  if (heal['auto-commit'] !== undefined && typeof heal['auto-commit'] !== 'boolean') {
    errors.push('"heal.auto-commit" must be a boolean.');
  }
  if (heal['commit-prefix'] !== undefined && (typeof heal['commit-prefix'] !== 'string' || heal['commit-prefix'].length === 0)) {
    errors.push('"heal.commit-prefix" must be a non-empty string.');
  }
}

export function validateReview(review: Record<string, unknown>, errors: string[], warnings: string[]): void {
  warnUnknownKeys(review, KNOWN_REVIEW_KEYS, 'review.', warnings);
  if (review['agent'] !== undefined && review['agent'] !== null) {
    if (typeof review['agent'] !== 'object') {
      errors.push('"review.agent" must be null or an object.');
    } else {
      validateAgentConfig(review['agent'] as Record<string, unknown>, 'review.agent', errors, warnings);
    }
  }
  if (review['scope'] !== undefined && !['staged', 'commit', 'range', 'working'].includes(review['scope'] as string)) {
    errors.push(`Invalid "review.scope": "${review['scope']}". Valid values: staged, commit, range, working.`);
  }
  if (review['context'] !== undefined) {
    if (typeof review['context'] !== 'object' || review['context'] === null) {
      errors.push('"review.context" must be an object.');
    } else {
      const context = review['context'] as Record<string, unknown>;
      warnUnknownKeys(context, KNOWN_REVIEW_CONTEXT_KEYS, 'review.context.', warnings);
      if (context['include-diff-context'] !== undefined) {
        const v = context['include-diff-context'];
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
          errors.push('"review.context.include-diff-context" must be a non-negative integer.');
        }
      }
      if (context['max-diff-lines'] !== undefined) {
        const v = context['max-diff-lines'];
        if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
          errors.push('"review.context.max-diff-lines" must be a positive integer.');
        }
      }
    }
  }
  if (review['output'] !== undefined) {
    if (typeof review['output'] !== 'object' || review['output'] === null) {
      errors.push('"review.output" must be an object.');
    } else {
      const output = review['output'] as Record<string, unknown>;
      warnUnknownKeys(output, KNOWN_REVIEW_OUTPUT_KEYS, 'review.output.', warnings);
      if (output['format'] !== undefined && !['text', 'json', 'markdown'].includes(output['format'] as string)) {
        errors.push(`Invalid "review.output.format": "${output['format']}". Valid values: text, json, markdown.`);
      }
      if (output['file'] !== undefined && output['file'] !== null && typeof output['file'] !== 'string') {
        errors.push('"review.output.file" must be null or a string.');
      }
      if (output['severity-threshold'] !== undefined && !['info', 'warn', 'error'].includes(output['severity-threshold'] as string)) {
        errors.push(`Invalid "review.output.severity-threshold": "${output['severity-threshold']}". Valid values: info, warn, error.`);
      }
    }
  }
}

export function validateScoring(scoring: Record<string, unknown>, errors: string[], warnings: string[]): void {
  warnUnknownKeys(scoring, KNOWN_SCORING_KEYS, 'scoring.', warnings);
  if (scoring['script'] !== undefined && scoring['script'] !== null && typeof scoring['script'] !== 'string') {
    errors.push('"scoring.script" must be null or a string.');
  }
  if (scoring['regression-threshold'] !== undefined) {
    const v = scoring['regression-threshold'];
    if (typeof v !== 'number' || v < 0 || v > 1) {
      errors.push('"scoring.regression-threshold" must be a number between 0.0 and 1.0.');
    }
  }
  if (scoring['cumulative-threshold'] !== undefined) {
    const v = scoring['cumulative-threshold'];
    if (typeof v !== 'number' || v < 0 || v > 1) {
      errors.push('"scoring.cumulative-threshold" must be a number between 0.0 and 1.0.');
    }
  }
  if (scoring['auto-revert'] !== undefined && typeof scoring['auto-revert'] !== 'boolean') {
    errors.push('"scoring.auto-revert" must be a boolean.');
  }
  if (scoring['default-weights'] !== undefined) {
    if (typeof scoring['default-weights'] !== 'object' || scoring['default-weights'] === null) {
      errors.push('"scoring.default-weights" must be an object.');
    } else {
      const weights = scoring['default-weights'] as Record<string, unknown>;
      warnUnknownKeys(weights, KNOWN_SCORING_WEIGHTS_KEYS, 'scoring.default-weights.', warnings);
      const tests = weights['tests'];
      const coverage = weights['coverage'];
      if (tests !== undefined && (typeof tests !== 'number' || tests < 0)) {
        errors.push('"scoring.default-weights.tests" must be a non-negative number.');
      }
      if (coverage !== undefined && (typeof coverage !== 'number' || coverage < 0)) {
        errors.push('"scoring.default-weights.coverage" must be a non-negative number.');
      }
      if (typeof tests === 'number' && typeof coverage === 'number') {
        if (Math.abs(tests + coverage - 1.0) > 0.001) {
          errors.push('"scoring.default-weights.tests" + "scoring.default-weights.coverage" must equal 1.0 (within 0.001 tolerance).');
        }
      }
    }
  }
}

export function validateCalibrationConfig(cal: Record<string, unknown>, errors: string[], warnings: string[]): void {
  warnUnknownKeys(cal, KNOWN_CALIBRATION_KEYS, 'calibration.', warnings);
  if (cal['window'] !== undefined) {
    const v = cal['window'];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 5) {
      errors.push('"calibration.window" must be an integer >= 5.');
    }
  }
  if (cal['warn-pass-rate'] !== undefined) {
    const v = cal['warn-pass-rate'];
    if (typeof v !== 'number' || v <= 0 || v > 1) {
      errors.push('"calibration.warn-pass-rate" must be a number in (0, 1].');
    }
  }
  if (cal['warn-discard-rate'] !== undefined) {
    const v = cal['warn-discard-rate'];
    if (typeof v !== 'number' || v < 0 || v >= 1) {
      errors.push('"calibration.warn-discard-rate" must be a number in [0, 1).');
    }
  }
  if (cal['warn-volatility'] !== undefined) {
    const v = cal['warn-volatility'];
    if (typeof v !== 'number' || v < 0) {
      errors.push('"calibration.warn-volatility" must be a number >= 0.');
    }
  }
}
