/**
 * Run-domain config validation (run, stages, adversarial).
 */

import {
  KNOWN_RUN_KEYS,
  KNOWN_RUN_PROMPTS_KEYS,
  KNOWN_RUN_LOOP_KEYS,
  KNOWN_RUN_VALIDATION_KEYS,
  KNOWN_RUN_GIT_KEYS,
  KNOWN_ADVERSARIAL_KEYS,
  warnUnknownKeys,
  validateStringArray,
  validateAgentConfig,
} from './validators.js';

export function validateRun(run: Record<string, unknown>, errors: string[], warnings: string[]): void {
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
  if (run['adversarial'] !== undefined) {
    if (typeof run['adversarial'] !== 'object' || run['adversarial'] === null) {
      errors.push('"run.adversarial" must be an object.');
    } else {
      validateAdversarialConfig(run['adversarial'] as Record<string, unknown>, errors, warnings);
    }
  }
}

export function validateStages(stages: unknown, errors: string[]): void {
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

export function validateAdversarialConfig(adv: Record<string, unknown>, errors: string[], warnings: string[]): void {
  warnUnknownKeys(adv, KNOWN_ADVERSARIAL_KEYS, 'run.adversarial.', warnings);
  if (adv['enabled'] !== undefined && typeof adv['enabled'] !== 'boolean') {
    errors.push('"run.adversarial.enabled" must be a boolean.');
  }
  if (adv['agent'] !== undefined && adv['agent'] !== null && typeof adv['agent'] !== 'string') {
    errors.push('"run.adversarial.agent" must be null or a string.');
  }
  if (adv['model'] !== undefined && adv['model'] !== null && typeof adv['model'] !== 'string') {
    errors.push('"run.adversarial.model" must be null or a string.');
  }
  if (adv['budget'] !== undefined) {
    const v = adv['budget'];
    if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
      errors.push('"run.adversarial.budget" must be a positive integer.');
    }
  }
  if (adv['timeout'] !== undefined) {
    const v = adv['timeout'];
    if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) {
      errors.push('"run.adversarial.timeout" must be a positive integer.');
    }
  }
  if (adv['diagnostic-branch'] !== undefined && typeof adv['diagnostic-branch'] !== 'boolean') {
    errors.push('"run.adversarial.diagnostic-branch" must be a boolean.');
  }
  if (adv['test-patterns'] !== undefined) {
    const valid = validateStringArray(adv['test-patterns'], 'run.adversarial.test-patterns', errors);
    if (valid && Array.isArray(adv['test-patterns']) && adv['test-patterns'].length === 0) {
      errors.push('"run.adversarial.test-patterns" must not be empty.');
    }
  }
  if (adv['restricted-patterns'] !== undefined) {
    validateStringArray(adv['restricted-patterns'], 'run.adversarial.restricted-patterns', errors);
  }
  if (adv['skip-on-simplify'] !== undefined && typeof adv['skip-on-simplify'] !== 'boolean') {
    errors.push('"run.adversarial.skip-on-simplify" must be a boolean.');
  }
}
