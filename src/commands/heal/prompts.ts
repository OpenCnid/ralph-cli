import type { DiagnosticResult, HealContext } from './types.js';

export const HEAL_TEMPLATE = `\
You are fixing issues found by ralph's diagnostic tools in {project_name}.

## Project Context
- Project path: {project_path}
- Date: {date}

## Diagnostics Output
{diagnostics_output}

## Fix Instructions

Read the diagnostic output carefully and fix only the reported issues.
Make the minimal change needed for each issue.
Do not lower quality bars, change ralph configuration to suppress failures, or refactor unrelated code.
After each fix, rerun the failing command to verify that it now passes.

If fixes conflict, prioritize them in this order:
1. doctor
2. lint
3. gc
4. grade

After all fixes are in place, run the full validation command:
\`\`\`
{validate_command}
\`\`\`
`;

function formatDiagnosticsOutput(diagnostics: DiagnosticResult[]): string {
  if (diagnostics.length === 0) {
    return '(none)';
  }

  return diagnostics
    .map((diagnostic) => {
      const trimmedOutput = diagnostic.output.trim();
      const outputBlock = trimmedOutput.length > 0 ? trimmedOutput : '(no output)';

      return [
        `### ${diagnostic.command}`,
        `Issues: ${diagnostic.issues}`,
        `Exit code: ${diagnostic.exitCode}`,
        '',
        outputBlock,
      ].join('\n');
    })
    .join('\n\n---\n\n');
}

export function generateHealPrompt(
  context: HealContext,
  validateCommand: string,
  projectPath: string,
  date: string,
): string {
  return HEAL_TEMPLATE
    .replace('{project_name}', context.projectName)
    .replace('{project_path}', projectPath)
    .replace('{date}', date)
    .replace('{diagnostics_output}', formatDiagnosticsOutput(context.diagnostics))
    .replace('{validate_command}', validateCommand);
}
