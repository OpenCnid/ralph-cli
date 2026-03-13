/**
 * Config validation — checks structure and values, producing errors and warnings.
 * Runs in under 100ms as required by spec.
 */

const VALID_LANGUAGES = ['typescript', 'javascript', 'python', 'go', 'rust', 'multi'];
const VALID_RUNNERS = ['codex', 'claude', 'amp', 'aider', 'cursor', 'other'];
const VALID_COVERAGE_TOOLS = ['vitest', 'jest', 'pytest', 'go-test', 'none'];
const VALID_GRADES = ['A', 'B', 'C', 'D', 'F'];

const KNOWN_TOP_KEYS = ['project', 'runner', 'architecture', 'quality', 'gc', 'doctor', 'paths', 'references', 'ci', 'run', 'review', 'heal', 'scoring'];
const KNOWN_SCORING_KEYS = ['script', 'regression-threshold', 'cumulative-threshold', 'auto-revert', 'default-weights'];
const KNOWN_SCORING_WEIGHTS_KEYS = ['tests', 'coverage'];
const KNOWN_HEAL_KEYS = ['agent', 'commands', 'auto-commit', 'commit-prefix'];
const VALID_HEAL_COMMANDS = ['doctor', 'grade', 'gc', 'lint'];
const KNOWN_REVIEW_KEYS = ['agent', 'scope', 'context', 'output'];
const KNOWN_REVIEW_CONTEXT_KEYS = ['include-specs', 'include-architecture', 'include-diff-context', 'max-diff-lines'];
const KNOWN_REVIEW_OUTPUT_KEYS = ['format', 'file', 'severity-threshold'];
const KNOWN_RUN_KEYS = ['agent', 'plan-agent', 'build-agent', 'prompts', 'loop', 'validation', 'git'];
const KNOWN_RUN_AGENT_KEYS = ['cli', 'args', 'timeout'];
const KNOWN_RUN_PROMPTS_KEYS = ['plan', 'build'];
const KNOWN_RUN_LOOP_KEYS = ['max-iterations', 'stall-threshold', 'iteration-timeout'];
const KNOWN_RUN_VALIDATION_KEYS = ['test-command', 'typecheck-command', 'stages'];
const KNOWN_RUN_GIT_KEYS = ['auto-commit', 'auto-push', 'commit-prefix', 'branch'];
const KNOWN_PROJECT_KEYS = ['name', 'language', 'description', 'framework'];
const KNOWN_RUNNER_KEYS = ['cli'];
const KNOWN_ARCHITECTURE_KEYS = ['layers', 'direction', 'domains', 'cross-cutting', 'rules'];
const VALID_DIRECTIONS = ['forward-only'];
const KNOWN_RULES_KEYS = ['max-lines', 'naming'];
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

function validateHealConfig(heal: Record<string, unknown>, errors: string[], warnings: string[]): void {
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
function validateAgentConfig(
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

function validateStages(stages: unknown, errors: string[]): void {
  if (!Array.isArray(stages)) { errors.push('"run.validation.stages" must be an array.'); return; }
  if (stages.length === 0) return;
  const names = new Set<string>();
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i] as Record<string, unknown> | undefined;
    if (!s || typeof s !== 'object') { errors.push(`"run.validation.stages[${i}]" must be an object.`); continue; }
    if (typeof s['name'] !== 'string' || s['name'].length === 0) {
      errors.push(`"run.validation.stages[${i}].name" is required and must be a non-empty string.`);
    } else {
      if (names.has(s['name'])) errors.push(`"run.validation.stages" has duplicate name: "${s['name']}".`);
      names.add(s['name']);
    }
    if (typeof s['command'] !== 'string' || s['command'].length === 0)
      errors.push(`"run.validation.stages[${i}].command" is required and must be a non-empty string.`);
    if (typeof s['required'] !== 'boolean')
      errors.push(`"run.validation.stages[${i}].required" is required and must be a boolean.`);
    if (s['run-after'] !== undefined && typeof s['run-after'] !== 'string')
      errors.push(`"run.validation.stages[${i}].run-after" must be a string.`);
    if (s['timeout'] !== undefined) {
      const t = s['timeout'];
      if (typeof t !== 'number' || !Number.isInteger(t) || t <= 0)
        errors.push(`"run.validation.stages[${i}].timeout" must be a positive integer.`);
    }
  }
  const stageMap = new Map<string, string | undefined>(
    (stages as Record<string, unknown>[])
      .filter(s => typeof s['name'] === 'string' && (s['name'] as string).length > 0)
      .map(s => [s['name'] as string, typeof s['run-after'] === 'string' ? s['run-after'] as string : undefined])
  );
  for (const [name, runAfter] of stageMap) {
    if (runAfter === undefined) continue;
    if (!stageMap.has(runAfter)) { errors.push(`"run.validation.stages" has run-after "${runAfter}" which does not reference an existing stage name.`); continue; }
    const visited = new Set<string>();
    let cur: string | undefined = runAfter;
    while (cur !== undefined) {
      if (cur === name) { errors.push(`"run.validation.stages" has a circular run-after chain involving "${name}".`); break; }
      if (visited.has(cur)) break;
      visited.add(cur); cur = stageMap.get(cur);
    }
  }
}

export function validate(raw: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // typeof null === 'object' in JS, so === null checks are required alongside typeof checks — not candidates for ?? migration
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
  if (obj['ci'] !== undefined) {
    if (typeof obj['ci'] !== 'object' || obj['ci'] === null) {
      errors.push('"ci" must be an object.');
    } else {
      const ci = obj['ci'] as Record<string, unknown>;
      warnUnknownKeys(ci, KNOWN_CI_KEYS, 'ci.', warnings);
    }
  }
  if (obj['run'] !== undefined) {
    if (typeof obj['run'] !== 'object' || obj['run'] === null) {
      errors.push('"run" must be an object.');
    } else {
      const run = obj['run'] as Record<string, unknown>;
      warnUnknownKeys(run, KNOWN_RUN_KEYS, 'run.', warnings);
      if (run['agent'] !== undefined) {
        if (typeof run['agent'] !== 'object' || run['agent'] === null) {
          errors.push('"run.agent" must be an object.');
        } else {
          validateAgentConfig(run['agent'] as Record<string, unknown>, 'run.agent', errors, warnings);
        }
      }
      for (const key of ['plan-agent', 'build-agent'] as const) {
        if (run[key] !== undefined && run[key] !== null) {
          if (typeof run[key] !== 'object') {
            errors.push(`"run.${key}" must be null or an object.`);
          } else {
            validateAgentConfig(run[key] as Record<string, unknown>, `run.${key}`, errors, warnings);
          }
        }
      }
      if (run['prompts'] !== undefined) {
        if (typeof run['prompts'] !== 'object' || run['prompts'] === null) {
          errors.push('"run.prompts" must be an object.');
        } else {
          const prompts = run['prompts'] as Record<string, unknown>;
          warnUnknownKeys(prompts, KNOWN_RUN_PROMPTS_KEYS, 'run.prompts.', warnings);
          if (prompts['plan'] !== undefined && prompts['plan'] !== null && typeof prompts['plan'] !== 'string') {
            errors.push('"run.prompts.plan" must be null or a string.');
          }
          if (prompts['build'] !== undefined && prompts['build'] !== null && typeof prompts['build'] !== 'string') {
            errors.push('"run.prompts.build" must be null or a string.');
          }
        }
      }
      if (run['loop'] !== undefined) {
        if (typeof run['loop'] !== 'object' || run['loop'] === null) {
          errors.push('"run.loop" must be an object.');
        } else {
          const loop = run['loop'] as Record<string, unknown>;
          warnUnknownKeys(loop, KNOWN_RUN_LOOP_KEYS, 'run.loop.', warnings);
          if (loop['max-iterations'] !== undefined) {
            const v = loop['max-iterations'];
            if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
              errors.push('"run.loop.max-iterations" must be a non-negative integer.');
            }
          }
          if (loop['stall-threshold'] !== undefined) {
            const v = loop['stall-threshold'];
            if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
              errors.push('"run.loop.stall-threshold" must be a non-negative integer.');
            }
          }
          if (loop['iteration-timeout'] !== undefined) {
            const v = loop['iteration-timeout'];
            if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
              errors.push('"run.loop.iteration-timeout" must be a non-negative integer.');
            }
          }
        }
      }
      if (run['validation'] !== undefined) {
        if (typeof run['validation'] !== 'object' || run['validation'] === null) {
          errors.push('"run.validation" must be an object.');
        } else {
          const validation = run['validation'] as Record<string, unknown>;
          warnUnknownKeys(validation, KNOWN_RUN_VALIDATION_KEYS, 'run.validation.', warnings);
          if (validation['test-command'] !== undefined && validation['test-command'] !== null && typeof validation['test-command'] !== 'string') {
            errors.push('"run.validation.test-command" must be null or a string.');
          }
          if (validation['typecheck-command'] !== undefined && validation['typecheck-command'] !== null && typeof validation['typecheck-command'] !== 'string') {
            errors.push('"run.validation.typecheck-command" must be null or a string.');
          }
          if (validation['stages'] !== undefined) {
            validateStages(validation['stages'], errors);
          }
        }
      }
      // git
      if (run['git'] !== undefined) {
        if (typeof run['git'] !== 'object' || run['git'] === null) {
          errors.push('"run.git" must be an object.');
        } else {
          const git = run['git'] as Record<string, unknown>;
          warnUnknownKeys(git, KNOWN_RUN_GIT_KEYS, 'run.git.', warnings);
          if (git['commit-prefix'] !== undefined) {
            if (typeof git['commit-prefix'] !== 'string' || git['commit-prefix'].length === 0) {
              errors.push('"run.git.commit-prefix" must be a non-empty string.');
            }
          }
          if (git['auto-commit'] !== undefined && typeof git['auto-commit'] !== 'boolean') {
            errors.push('"run.git.auto-commit" must be a boolean.');
          }
          if (git['auto-push'] !== undefined && typeof git['auto-push'] !== 'boolean') {
            errors.push('"run.git.auto-push" must be a boolean.');
          }
          if (git['branch'] !== undefined && git['branch'] !== null && typeof git['branch'] !== 'string') {
            errors.push('"run.git.branch" must be null or a string.');
          }
        }
      }
    }
  }
  if (obj['review'] !== undefined) {
    if (typeof obj['review'] !== 'object' || obj['review'] === null) {
      errors.push('"review" must be an object.');
    } else {
      const review = obj['review'] as Record<string, unknown>;
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
  }
  if (obj['heal'] !== undefined) {
    if (typeof obj['heal'] !== 'object' || obj['heal'] === null) {
      errors.push('"heal" must be an object.');
    } else {
      validateHealConfig(obj['heal'] as Record<string, unknown>, errors, warnings);
    }
  }
  if (obj['scoring'] !== undefined) {
    if (typeof obj['scoring'] !== 'object' || obj['scoring'] === null) {
      errors.push('"scoring" must be an object.');
    } else {
      const scoring = obj['scoring'] as Record<string, unknown>;
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
  }
  return { errors, warnings };
}
