/**
 * Config validation — checks structure and values, producing errors and warnings.
 * Runs in under 100ms as required by spec.
 *
 * Domain-specific validators are in validators.ts. This file orchestrates them.
 */

import {
  KNOWN_TOP_KEYS,
  warnUnknownKeys,
  validateProject,
  validateRunner,
  validateArchitecture,
  validateQuality,
  validateDoctor,
  validateGc,
  validatePaths,
  validateReferences,
  validateCi,
  validateReview,
  validateHealConfig,
  validateScoring,
  validateCalibrationConfig,
} from './validators.js';
import { validateRun } from './validate-run.js';

export interface ValidationResult {
  errors: string[];
  warnings: string[];
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
  warnUnknownKeys(obj, KNOWN_TOP_KEYS, '', warnings);

  // project (required)
  if (!obj['project'] || typeof obj['project'] !== 'object') {
    errors.push('Missing required "project" section. Fix: add `project:` with `name` and `language`.');
    return { errors, warnings };
  }
  validateProject(obj['project'] as Record<string, unknown>, errors, warnings);

  // runner (optional)
  if (obj['runner'] !== undefined) {
    if (typeof obj['runner'] !== 'object' || obj['runner'] === null) {
      errors.push('"runner" must be an object. Fix: `runner:\\n  cli: codex`');
    } else {
      validateRunner(obj['runner'] as Record<string, unknown>, warnings);
    }
  }

  // architecture (optional)
  if (obj['architecture'] !== undefined) {
    if (typeof obj['architecture'] !== 'object' || obj['architecture'] === null) {
      errors.push('"architecture" must be an object.');
    } else {
      validateArchitecture(obj['architecture'] as Record<string, unknown>, errors, warnings);
    }
  }

  // quality (optional)
  if (obj['quality'] !== undefined) {
    if (typeof obj['quality'] !== 'object' || obj['quality'] === null) {
      errors.push('"quality" must be an object.');
    } else {
      validateQuality(obj['quality'] as Record<string, unknown>, errors, warnings);
    }
  }

  // doctor (optional)
  if (obj['doctor'] !== undefined) {
    if (typeof obj['doctor'] !== 'object' || obj['doctor'] === null) {
      errors.push('"doctor" must be an object.');
    } else {
      validateDoctor(obj['doctor'] as Record<string, unknown>, errors, warnings);
    }
  }

  // gc (optional)
  if (obj['gc'] !== undefined) {
    if (typeof obj['gc'] !== 'object' || obj['gc'] === null) {
      errors.push('"gc" must be an object.');
    } else {
      validateGc(obj['gc'] as Record<string, unknown>, errors, warnings);
    }
  }

  // paths (optional)
  if (obj['paths'] !== undefined) {
    if (typeof obj['paths'] !== 'object' || obj['paths'] === null) {
      errors.push('"paths" must be an object.');
    } else {
      validatePaths(obj['paths'] as Record<string, unknown>, errors, warnings);
    }
  }

  // references (optional)
  if (obj['references'] !== undefined) {
    if (typeof obj['references'] !== 'object' || obj['references'] === null) {
      errors.push('"references" must be an object.');
    } else {
      validateReferences(obj['references'] as Record<string, unknown>, errors, warnings);
    }
  }

  // ci (optional)
  if (obj['ci'] !== undefined) {
    if (typeof obj['ci'] !== 'object' || obj['ci'] === null) {
      errors.push('"ci" must be an object.');
    } else {
      validateCi(obj['ci'] as Record<string, unknown>, warnings);
    }
  }

  // run (optional)
  if (obj['run'] !== undefined) {
    if (typeof obj['run'] !== 'object' || obj['run'] === null) {
      errors.push('"run" must be an object.');
    } else {
      validateRun(obj['run'] as Record<string, unknown>, errors, warnings);
    }
  }

  // review (optional)
  if (obj['review'] !== undefined) {
    if (typeof obj['review'] !== 'object' || obj['review'] === null) {
      errors.push('"review" must be an object.');
    } else {
      validateReview(obj['review'] as Record<string, unknown>, errors, warnings);
    }
  }

  // heal (optional)
  if (obj['heal'] !== undefined) {
    if (typeof obj['heal'] !== 'object' || obj['heal'] === null) {
      errors.push('"heal" must be an object.');
    } else {
      validateHealConfig(obj['heal'] as Record<string, unknown>, errors, warnings);
    }
  }

  // scoring (optional)
  if (obj['scoring'] !== undefined) {
    if (typeof obj['scoring'] !== 'object' || obj['scoring'] === null) {
      errors.push('"scoring" must be an object.');
    } else {
      validateScoring(obj['scoring'] as Record<string, unknown>, errors, warnings);
    }
  }

  // calibration (optional)
  if (obj['calibration'] !== undefined) {
    if (typeof obj['calibration'] !== 'object' || obj['calibration'] === null) {
      errors.push('"calibration" must be an object.');
    } else {
      validateCalibrationConfig(obj['calibration'] as Record<string, unknown>, errors, warnings);
    }
  }

  return { errors, warnings };
}
