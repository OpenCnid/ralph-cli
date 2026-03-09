import { readFileSync } from 'node:fs';
import type { RalphConfig } from '../../config/schema.js';
import type { RunMode } from './types.js';
import {
  detectTestCommand,
  detectTypecheckCommand,
  detectSourcePath,
  composeValidateCommand,
} from './detect.js';

export const PLAN_TEMPLATE = `\
# Planning Session

Project: {project_name}
Date: {date}
Language: {language}
Framework: {framework}
Project Path: {project_path}
Source Path: {src_path}
Specs Path: {specs_path}

## Validation Command
{validate_command}

## Commands
- Test: {test_command}
- Typecheck: {typecheck_command}

## Instructions
Review the specs in {specs_path} and create or update IMPLEMENTATION_PLAN.md with a detailed task list.
Each task should be small, testable, and independently completable.

{skip_tasks}
`;

export const BUILD_TEMPLATE = `\
# Build Session

Project: {project_name}
Date: {date}
Language: {language}
Framework: {framework}
Project Path: {project_path}
Source Path: {src_path}
Specs Path: {specs_path}

## Validation Command
{validate_command}

## Commands
- Test: {test_command}
- Typecheck: {typecheck_command}

## Instructions
Implement the next uncompleted task in IMPLEMENTATION_PLAN.md.
Run {validate_command} after completing work to verify correctness.
Mark the task as complete when done.

{skip_tasks}
`;

function buildVariables(
  config: RalphConfig,
  options: { skipTasks?: string | undefined },
): Record<string, string> {
  const testCmd = detectTestCommand(config);
  const typecheckCmd = detectTypecheckCommand(config);
  const validateCmd = composeValidateCommand(testCmd, typecheckCmd);

  const now = new Date().toISOString().slice(0, 10);

  return {
    project_name: config.project.name,
    project_path: process.cwd(),
    src_path: detectSourcePath(config),
    specs_path: config.paths.specs,
    date: now,
    test_command: testCmd ?? '',
    typecheck_command: typecheckCmd ?? '',
    validate_command: validateCmd,
    skip_tasks: options.skipTasks ?? '',
    language: config.project.language,
    framework: config.project.framework ?? '',
  };
}

function applyVariables(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = vars[key];
    return value !== undefined ? value : match;
  });
}

function loadTemplate(filePath: string): string {
  return readFileSync(filePath, 'utf-8');
}

/**
 * Generate a prompt string for the given run mode.
 * Uses a custom template file if configured, otherwise uses the built-in template.
 * Missing variables in custom templates are left as-is.
 */
export function generatePrompt(
  mode: RunMode,
  config: RalphConfig,
  options: { skipTasks?: string | undefined } = {},
): string {
  let template: string;

  const customPath = config.run?.prompts?.[mode] ?? null;
  if (customPath != null) {
    template = loadTemplate(customPath);
  } else {
    template = mode === 'plan' ? PLAN_TEMPLATE : BUILD_TEMPLATE;
  }

  const vars = buildVariables(config, options);
  return applyVariables(template, vars);
}
