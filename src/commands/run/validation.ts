import type { RunConfig } from './types.js';
import type { StageResult } from './stages.js';
import { synthesizeDefaultStages, executeStages } from './stages.js';

export interface ValidationResult {
  passed: boolean;
  testOutput: string;
  stages: StageResult[];
  failedStage: string | null;
}

/**
 * Runs post-agent validation using the stage pipeline executor.
 *
 * If `config.validation.stages` is defined and non-empty, runs those stages.
 * Otherwise, synthesizes default stages from test-command and typecheck-command.
 * Returns { passed, testOutput, stages, failedStage }.
 */
export function runValidation(config: RunConfig): ValidationResult {
  const testCommand = config.validation['test-command'];
  const typecheckCommand = config.validation['typecheck-command'];
  const configuredStages = config.validation.stages;

  const stages =
    configuredStages !== undefined && configuredStages.length > 0
      ? configuredStages
      : synthesizeDefaultStages(testCommand, typecheckCommand);

  const result = executeStages(stages);

  return {
    passed: result.passed,
    testOutput: result.testOutput,
    stages: result.stages,
    failedStage: result.failedStage,
  };
}
