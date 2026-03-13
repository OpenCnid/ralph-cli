import type { ReviewContext } from './types.js';

export const REVIEW_TEMPLATE = `\
You are reviewing code changes for {project_name}.

## Project Architecture
{architecture_content}

## Relevant Specifications
{specs_content}

## Project Rules
{rules_content}

## Changes to Review

### Files Changed
{diff_stat}

### Diff
{diff_content}

## Review Instructions

Analyze the changes above and provide a code review. For each issue found:

1. **Severity**: error (must fix), warn (should fix), info (suggestion)
2. **File and line**: Where the issue is
3. **Description**: What's wrong and why
4. **Suggestion**: How to fix it

Focus on:
- Architectural violations (layer rules, domain boundaries, import direction)
- Spec compliance (do the changes match what was specified?)
- Logic errors and edge cases
- Missing tests for new behavior
- Breaking changes to public APIs
- Security concerns

Do NOT flag:
- Style preferences (formatting, naming that passes lint)
- Minor refactoring opportunities unless they affect correctness
- TODOs or incomplete features that are explicitly documented as such

If the changes look correct, say so briefly. Don't manufacture issues.

End with a summary: APPROVE, REQUEST_CHANGES, or CONCERNS (non-blocking observations).`;

export const INTENT_REVIEW_TEMPLATE = `\
You are reviewing code changes for {project_name}.

## Problem Context (from spec motivations)
{motivations_content}

## Project Architecture
{architecture_content}

## Changes to Review

### Files Changed
{diff_stat}

### Diff
{diff_content}

## Review Instructions

Read the Problem Context above. It describes WHY these changes are being made —
the underlying problem, not the specific requirements.

Now read the implementation. Does it actually solve the problem described above?

Focus on:
- Does the implementation address the root cause, or just the symptoms?
- Is the scope right? (per-user vs per-IP, global vs scoped, etc.)
- Does the approach have known failure modes for this specific use case?
- Are there aspects of the motivation that the implementation doesn't address?
- Would someone reading just the motivation be surprised by this implementation?

Do NOT focus on:
- Whether specific requirements or checkboxes are met (that's standard review)
- Style, formatting, or naming preferences
- Test coverage (that's fitness scoring)

For each concern found:
1. **Severity**: error (fundamental mismatch), warn (partial mismatch), info (worth considering)
2. **What the motivation says**: Quote the relevant part
3. **What the implementation does**: Describe the mismatch
4. **Suggestion**: How to better align with the intent

End with: APPROVE, REQUEST_CHANGES, or CONCERNS.`;

export function generateReviewPrompt(
  context: ReviewContext,
  options: { diffOnly: boolean; intent?: boolean | undefined },
): string {
  if (options.intent) {
    let template = INTENT_REVIEW_TEMPLATE;

    if (options.diffOnly) {
      template = template.replace(/^## Project Architecture\n\{architecture_content\}\n\n/m, '');
    }

    const motivationsContent =
      context.motivations.length > 0
        ? context.motivations.join('\n\n---\n\n')
        : '(No motivation sections found in relevant specs. Review will focus on general implementation quality against the diff.)';

    return template
      .replace('{project_name}', context.projectName)
      .replace('{motivations_content}', motivationsContent)
      .replace('{architecture_content}', context.architecture || '(none)')
      .replace('{diff_stat}', context.diffStat)
      .replace('{diff_content}', context.diff);
  }

  let template = REVIEW_TEMPLATE;

  if (options.diffOnly) {
    // Remove context sections (architecture, specs, rules)
    template = template
      .replace(/^## Project Architecture\n\{architecture_content\}\n\n/m, '')
      .replace(/^## Relevant Specifications\n\{specs_content\}\n\n/m, '')
      .replace(/^## Project Rules\n\{rules_content\}\n\n/m, '');
  }

  const specsContent =
    context.specs.length > 0 ? context.specs.join('\n\n---\n\n') : '(none)';

  return template
    .replace('{project_name}', context.projectName)
    .replace('{architecture_content}', context.architecture || '(none)')
    .replace('{specs_content}', specsContent)
    .replace('{rules_content}', context.rules || '(none)')
    .replace('{diff_stat}', context.diffStat)
    .replace('{diff_content}', context.diff);
}
