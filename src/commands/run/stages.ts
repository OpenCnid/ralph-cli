import { spawnSync } from 'node:child_process';
import type { ValidationStage } from '../../config/schema.js';

export interface StageResult {
  name: string;
  passed: boolean;
  exitCode: number;
  output: string;
  durationMs: number;
  skipped: boolean;
}

export function synthesizeDefaultStages(
  testCmd: string | null,
  typecheckCmd: string | null,
): ValidationStage[] {
  const stages: ValidationStage[] = [];
  if (testCmd !== null) {
    stages.push({ name: 'test', command: testCmd, required: true, timeout: 120 });
  }
  if (typecheckCmd !== null) {
    stages.push({ name: 'typecheck', command: typecheckCmd, required: true, timeout: 120 });
  }
  return stages;
}

export function executeStages(
  stages: ValidationStage[],
  cwd?: string,
): { passed: boolean; stages: StageResult[]; failedStage: string | null; testOutput: string } {
  const results: StageResult[] = [];
  let failedStage: string | null = null;

  for (const stage of stages) {
    // Check run-after dependency (transitive)
    if (stage['run-after'] !== undefined) {
      const predecessor = results.find((r) => r.name === stage['run-after']);
      if (predecessor !== undefined && (!predecessor.passed || predecessor.skipped)) {
        results.push({
          name: stage.name,
          passed: false,
          exitCode: -1,
          output: '',
          durationMs: 0,
          skipped: true,
        });
        continue;
      }
    }

    const timeoutMs = (stage.timeout ?? 120) * 1000;
    const start = Date.now();
    const result = spawnSync('sh', ['-c', stage.command], {
      timeout: timeoutMs,
      encoding: 'utf-8',
      cwd,
    });
    const durationMs = Date.now() - start;

    const timedOut = result.signal === 'SIGTERM' && result.status === null;
    const exitCode = timedOut ? -1 : (result.status ?? -1);
    const rawOutput = (result.stdout ?? '') + (result.stderr ?? '');
    const output = timedOut
      ? rawOutput + `\ntimed out after ${stage.timeout ?? 120}s`
      : rawOutput;

    const passed = !timedOut && result.status === 0 && result.signal === null;

    results.push({ name: stage.name, passed, exitCode, output, durationMs, skipped: false });

    if (!passed && stage.required) {
      failedStage = stage.name;
      break;
    }
  }

  const passed = failedStage === null;

  // Determine testOutput
  const testStage = results.find((r) => r.name === 'test' || r.name === 'unit');
  const firstStage = results[0];
  const testOutput = testStage !== undefined
    ? testStage.output
    : firstStage !== undefined
      ? firstStage.output
      : '';

  return { passed, stages: results, failedStage, testOutput };
}
