import { spawnSync } from 'node:child_process';
import type { RunConfig } from './types.js';

const VALIDATION_TIMEOUT_MS = 120_000;

export interface ValidationResult {
  passed: boolean;
  testOutput: string;
}

/**
 * Runs post-agent validation commands (test-command and typecheck-command).
 *
 * Runs test-command first (capturing stdout), then typecheck-command.
 * Each has a hardcoded 120s timeout; exceeding it is treated as failure.
 * Returns { passed: true, testOutput } when all configured commands pass.
 * Returns { passed: false, testOutput } on first non-zero exit or timeout.
 * When both commands are null, validation is skipped and passes immediately.
 */
export function runValidation(config: RunConfig): ValidationResult {
  const testCommand = config.validation['test-command'];
  const typecheckCommand = config.validation['typecheck-command'];

  let testOutput = '';

  if (testCommand !== null) {
    const result = spawnSync('sh', ['-c', testCommand], {
      timeout: VALIDATION_TIMEOUT_MS,
      encoding: 'utf-8',
    });

    testOutput = result.stdout ?? '';

    if (result.status !== 0 || result.signal !== null) {
      return { passed: false, testOutput };
    }
  }

  if (typecheckCommand !== null) {
    const result = spawnSync('sh', ['-c', typecheckCommand], {
      timeout: VALIDATION_TIMEOUT_MS,
      encoding: 'utf-8',
    });

    if (result.status !== 0 || result.signal !== null) {
      return { passed: false, testOutput };
    }
  }

  return { passed: true, testOutput };
}
