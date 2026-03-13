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

**Project:** {project_name}
**Date:** {date}
**Language:** {language}
**Framework:** {framework}
**Project Path:** {project_path}
**Source Path:** {src_path}
**Specs Path:** {specs_path}

## Validation
Run this before finishing to confirm the codebase is in a good state:
\`\`\`
{validate_command}
\`\`\`
(Individual commands: test — \`{test_command}\`, typecheck — \`{typecheck_command}\`)

## Your Task: Planning Only

**Do NOT implement anything.** This session is for analysis and planning only.

### Step 1 — Read the specs

Read every file in \`{specs_path}\`. Understand the full scope of requirements:
- What features are specified?
- What behaviour is expected?
- What constraints or non-goals are stated?

### Step 2 — Read the existing code

Read the source code in \`{src_path}\` to understand what already exists:
- What is already implemented?
- What is partially implemented?
- What is missing entirely?

### Step 3 — Gap analysis

Produce a clear gap analysis:
- For each spec requirement, determine if it is: done, partial, or missing.
- Identify any code that exists but is not covered by specs (potential dead weight or undocumented features).

### Step 4 — Validate the current state

Run the validation command to confirm the current baseline:
\`\`\`
{validate_command}
\`\`\`
Note any pre-existing failures. These must be fixed before new work begins.

### Step 5 — Write or update IMPLEMENTATION_PLAN.md

Create or update \`IMPLEMENTATION_PLAN.md\` at the project root with a prioritised task list.

Rules for task authoring:
- **One task = one focused change.** Each task must be completable in a single iteration.
- **No bundling.** Do not combine multiple features, refactors, or fixes into one task.
- **Dependency order.** List tasks in the order they must be completed. If task B depends on task A, task A comes first.
- **Unchecked by default.** All new tasks start with \`[ ]\`. Already-completed work uses \`[x]\`.
- **Descriptive titles.** Each task title should make clear what will change (e.g., "Add rate-limiting middleware to POST /api/login").

Format each task as:
\`\`\`
- [ ] Task title
  Brief description of what to implement, which spec it satisfies, and any dependencies.
\`\`\`

Do not add implementation notes, code snippets, or architectural opinions beyond what is needed to complete the task.

{skip_tasks}
`;

export const BUILD_TEMPLATE = `\
<!-- Template Placeholder Contract
Placeholders: {project_name}, {date}, {language}, {framework}, {project_path}, {src_path}, {specs_path}, {validate_command}, {test_command}, {typecheck_command}, {skip_tasks}, {score_context}
Contract version: 1
Consumers: src/commands/run/prompts.ts, src/commands/run/scoring.ts
-->
# Build Session

**Project:** {project_name}
**Date:** {date}
**Language:** {language}
**Framework:** {framework}
**Project Path:** {project_path}
**Source Path:** {src_path}
**Specs Path:** {specs_path}

## Validation
Run this after completing your work. All checks must pass before you finish:
\`\`\`
{validate_command}
\`\`\`
(Individual commands: test — \`{test_command}\`, typecheck — \`{typecheck_command}\`)

{score_context}
## Your Task: One Task Per Iteration

**Do NOT work on more than one task.** Pick the next unchecked task from the plan and implement only that.

### Step 1 — Find the next unchecked task

Open \`IMPLEMENTATION_PLAN.md\` and find the first line with \`[ ]\` (an unchecked checkbox).
That is the task you will implement. Do not skip ahead or pick a different task.

{skip_tasks}

### Step 2 — Read the relevant spec

Open \`{specs_path}\` and find the section(s) that describe the behaviour required by this task.
Read carefully. Implement exactly what the spec requires — no more, no less.

### Step 3 — Implement the task

Make the changes needed to complete the task. Follow existing code conventions in \`{src_path}\`:
- Match the file structure, naming conventions, and patterns already in use.
- Keep the change focused. Do not refactor surrounding code unless the task requires it.
- Do not introduce new dependencies without a clear reason stated in the spec.

### Step 4 — Validate your work

Run the full validation suite:
\`\`\`
{validate_command}
\`\`\`

If any check fails, fix the failure before continuing. Do not proceed with a broken build.
Repeat: fix all failures, then re-run validation until it is fully green.

### Step 5 — Mark the task complete

Update \`IMPLEMENTATION_PLAN.md\`: change the task's \`[ ]\` to \`[x]\`.
Do not modify any other tasks or add new tasks.

### Step 6 — Commit your work

Create a single focused commit that contains only the work for this task.
Commit message format: \`{project_name}: <short description of what was done>\`

Do not commit unrelated changes, formatting-only edits, or work from other tasks.
`;

function buildVariables(
  config: RalphConfig,
  options: { skipTasks?: string | undefined; scoreContext?: string | undefined },
): Record<string, string> {
  const testCmd = detectTestCommand(config);
  const typecheckCmd = detectTypecheckCommand(config);
  const validateCmd = composeValidateCommand(testCmd, typecheckCmd, config.run?.validation?.stages);

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
    score_context: options.scoreContext ?? '',
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

const SIMPLIFY_PREAMBLE = `\
## Your Task: Simplification

SIMPLIFICATION ITERATION — Your goal: reduce code while maintaining quality.

Rules:
- Remove dead code, redundant abstractions, unnecessary complexity
- Tests must still pass
- Score must not decrease (current: {score})
- Do NOT add new features
- Deleting code that maintains the score is a success
- Improving the score by deleting code is an excellent success

Current metrics: {metrics}
`;

const ADVERSARIAL_TEMPLATE = `\
# Adversarial Testing Session

You are reviewing code that was just implemented by another agent. Your job is
to find bugs by writing tests that expose edge cases, boundary conditions, and
error paths the implementer likely missed.

## What Changed
{builder_diff}

## Relevant Spec
{spec_content}

## Existing Tests
{existing_tests}

## Validation Results
{stage_results}

## Rules

1. **Write tests only.** Do not modify any implementation file. Any changes to
   non-test files will be automatically reverted before your tests run. Your
   tests must pass against the unmodified implementation.

2. **Do not delete or rewrite existing tests.** Add new test cases only.
   Removing or replacing existing tests will be detected and the adversarial
   pass will be aborted. Your job is to ADD coverage, not reorganize it.

3. **Do not modify IMPLEMENTATION_PLAN.md or any .md file.** Your scope is
   test files only.

4. **Target edge cases.** Empty inputs, null/undefined values, maximum sizes,
   boundary values, malformed data, off-by-one errors, type coercion, error
   paths, timeout scenarios, concurrent access patterns.

5. **Be specific.** Each test should target one specific edge case with a clear
   name describing what it tests (e.g., "should reject negative timeout values"
   not "should handle edge cases").

6. **Maximum {budget} tests.** Quality over quantity. Do not write trivial
   assertions (e.g., \`expect(true).toBe(true)\`).

7. **Use the project's test framework.** Match existing test patterns,
   imports, and conventions. Look at {existing_tests} for examples.

8. **Run the tests.** Execute \`{test_command}\` after writing. If your tests
   fail because of a real bug in the implementation, leave them as-is — exposing
   bugs is the goal. If your tests fail because of a mistake in your test code
   (wrong import, syntax error), fix your test.

9. **Do not fix implementation bugs.** Even if you find a bug, do not modify
   implementation files. Write a test that demonstrates the bug and leave it
   failing.

If you cannot find meaningful edge cases worth testing, write nothing. An empty
result is better than trivial tests. An empty result will not cause a revert.
`;

/**
 * Generate the adversary agent prompt for a single adversarial pass.
 */
export function generateAdversarialPrompt(opts: {
  builderDiff: string;
  specContent: string;
  existingTests: string;
  stageResults: string | null;
  budget: number;
  testCommand: string;
}): string {
  const vars: Record<string, string> = {
    builder_diff: opts.builderDiff,
    spec_content: opts.specContent,
    existing_tests: opts.existingTests,
    stage_results: opts.stageResults ?? 'Validation passed.',
    budget: String(opts.budget),
    test_command: opts.testCommand,
  };
  return ADVERSARIAL_TEMPLATE.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = vars[key];
    return value !== undefined ? value : match;
  });
}

/**
 * Generate a prompt string for the given run mode.
 * Uses a custom template file if configured, otherwise uses the built-in template.
 * Missing variables in custom templates are left as-is.
 */
export function generatePrompt(
  mode: RunMode,
  config: RalphConfig,
  options: {
    skipTasks?: string | undefined;
    scoreContext?: string | undefined;
    simplify?: boolean | undefined;
    lastScore?: number | null | undefined;
    lastMetrics?: string | undefined;
  } = {},
): string {
  let template: string;

  const customPath = config.run?.prompts?.[mode] ?? null;
  if (customPath != null) {
    template = loadTemplate(customPath);
  } else {
    template = mode === 'plan' ? PLAN_TEMPLATE : BUILD_TEMPLATE;
  }

  const vars = buildVariables(config, options);
  let result = applyVariables(template, vars);

  // --simplify: replace everything from "## Your Task" onward with the simplification preamble
  if (options.simplify === true && mode === 'build') {
    const taskIdx = result.indexOf('\n## Your Task');
    if (taskIdx >= 0) {
      result = result.slice(0, taskIdx + 1); // keep the newline before the heading
    }
    const score = options.lastScore != null ? options.lastScore.toFixed(3) : '(not yet scored)';
    const metrics = options.lastMetrics ?? '—';
    result += SIMPLIFY_PREAMBLE.replace('{score}', score).replace('{metrics}', metrics);
  }

  return result;
}
