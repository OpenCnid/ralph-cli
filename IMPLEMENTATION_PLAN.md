# Implementation Plan — Trust Calibration Phase 4

Spec: `docs/product-specs/intent-verification.md`
Date: 2026-03-13

## Pre-flight

- [x] No pre-existing validation failures
- Regression baseline: 989 tests passing, typecheck clean (0 errors)

---

## Types

- [ ] Add `intent` to `ReviewOptions` and `motivations` to `ReviewContext` in `src/commands/review/types.ts`

  Add `intent?: boolean | undefined` to `ReviewOptions`.
  Add `motivations: string[]` to `ReviewContext`.

  Satisfies: F-IV04 (type plumbing), Compatibility Notes (test mocks must include `motivations: []`).

  Verify: `npx tsc --noEmit` passes. Both interfaces contain the new fields.

---

## Core Implementation

- [ ] Add `extractMotivation()` to `src/commands/review/context.ts`

  Add `extractMotivation(specContent: string): string | null`.
  Algorithm: line-by-line scan. Find first line matching `/^## .*(motivation)/i`. Collect lines until the
  next `#` or `##` heading (or EOF). Trim result. Return `null` if not found or if result is empty/whitespace.

  Satisfies: F-IV02 (all 8 edge cases in the spec — present, absent, whitespace-only, EOF, case-insensitive,
  h3-ignored, first-wins, partial-heading).

  Verify: Run `npm test` — 8 new unit tests in `context.test.ts` all pass.

- [ ] Add `INTENT_REVIEW_TEMPLATE` and update `generateReviewPrompt()` in `src/commands/review/prompts.ts`

  Add `INTENT_REVIEW_TEMPLATE` constant with exact template text from spec (F-IV03 section).
  Update `generateReviewPrompt(context, options)` signature: `options` adds `intent?: boolean`.
  When `intent: true`, use `INTENT_REVIEW_TEMPLATE`; when false/absent, use `REVIEW_TEMPLATE` (unchanged).

  `{motivations_content}` placeholder resolves to:
  - `context.motivations.join('\n\n---\n\n')` when motivations exist
  - `"(No motivation sections found in relevant specs. Review will focus on general implementation quality against the diff.)"` when empty

  `diffOnly` with `intent: true`: omit `{architecture_content}` and `{rules_content}` sections (same strip
  logic as standard), but always keep `{motivations_content}`.

  Satisfies: F-IV03 (all 4 edge cases: no motivations, diffOnly+intent, multiple specs, no specs).

  Verify: 5 new unit tests in `prompts.test.ts` pass. `generateReviewPrompt(ctx, { diffOnly: false, intent: false })`
  returns identical output to before (regression check).

---

## Integration

- [ ] Wire `--intent` through CLI, `reviewCommand()`, and context assembly in:
  - `src/cli.ts` — add `.option('--intent', 'Review against spec motivations instead of requirements')` to the `review` command and add `intent?: boolean` to the action options type
  - `src/commands/review/index.ts` — pass `intent: options.intent ?? false` to `generateReviewPrompt()`; after `assembleContext()` returns, populate `reviewContext.motivations` by calling `extractMotivation()` on each spec in `reviewContext.specs` (filter nulls)
  - `src/commands/review/context.ts` — add `motivations: []` to the `ReviewContext` returned by `assembleContext()` (population happens in `reviewCommand`, not here)

  Satisfies: F-IV04 (all success criteria: `intent` reaches `generateReviewPrompt`, types include fields, CLI
  help shows `--intent`, all flag combinations work).

  Verify: `ralph review --help` lists `--intent`. `ralph review --intent --dry-run` on a spec with
  `## Motivation` prints a prompt containing "Problem Context" and the motivation text.

---

## Doctor Check

- [ ] Add motivation-section check to `runContentChecks()` in `src/commands/doctor/checks.ts`

  Pattern: follow the exact structure of existing checks in `runContentChecks()`.
  - Scan all `.md` files under `config.paths.specs` (use `readdirSync`, catch if dir missing → pass: true, "No spec files found").
  - For each file, check for `/^## .*(motivation)/im` heading presence (same pattern as `extractMotivation` but presence-only — even an empty section passes the doctor check per spec).
  - Report:
    - All present → `pass: true`, detail: `"All N spec(s) have ## Motivation sections"`
    - Some missing → `pass: false`, detail: `"M of N spec(s) missing ## Motivation section: [filenames]"`, fix: `"Add a ## Motivation section to each spec describing why the feature exists."`
    - No spec files → `pass: true`, detail: `"No spec files found"`
  - `name: "Spec files have ## Motivation sections"`, `category: 'content'`

  Satisfies: F-IV05 (all 4 success criteria and 3 edge cases).

  Note: `--ci` exit is controlled by score threshold, not individual check pass/fail — no special handling needed.

  Verify: 4 new tests in `doctor.test.ts` pass. `ralph doctor` output includes motivation check line.

---

## Spec Template Convention

- [ ] Update `productSpecsIndexMd()` in `src/commands/init/templates.ts`

  In the `## Convention` bullet list, add one line:
  `- Each spec should include a \`## Motivation\` section between the title and \`## Requirements\` (or equivalent). Describe the problem being solved, not the solution.`

  Satisfies: F-IV01. ≤5 lines added to the existing convention block.

  Verify: Call `productSpecsIndexMd()` in tests or manual check — output contains "Motivation".

---

## CLI Test

- [ ] Add `--intent` parsing tests to `src/commands/review/cli.test.ts` (or the file covering CLI parsing for review)

  - `ralph review --intent` → `options.intent === true`
  - `ralph review --intent --dry-run --diff-only --verbose` → all flags parse correctly

  Satisfies: F-IV04 CLI success criteria.

---

## Review Command Tests

- [ ] Add `--intent` flow tests to `src/commands/review/review.test.ts`

  - `--intent` flag passes `intent: true` to `generateReviewPrompt()` (mock chain)
  - `--intent --dry-run` prints intent prompt
  - without `--intent`, `intent` defaults to false (regression)

  Satisfies: F-IV04 + F-IV03 integration success criteria.

---

## Backward Compatibility

- [ ] Verify backward compatibility

  Run `npm test && npx tsc --noEmit`.
  Confirm:
  - `ralph review` (without `--intent`) produces identical prompt output (check with `--dry-run`)
  - All 989 pre-existing tests still pass (test count must be ≥ 989; new tests will push it higher)
  - Any test mock constructing `ReviewContext` has `motivations: []` added (TypeScript will catch this)
  - Doctor score may shift slightly (denominator +1); verify `ralph doctor --ci` still passes

---

## Verification

- [ ] Run full validation and verify all Phase 4 acceptance criteria

  ```
  npm test && npx tsc --noEmit && ralph doctor --ci && ralph grade --ci
  ```

  Cross-check each success criterion from the spec:

  - **SC-1 (Immediate):** `ralph review --intent --dry-run` on a repo with motivation-bearing specs prints a
    prompt containing the motivation text and "Problem Context" heading. Verify manually.
  - **SC-2 (Mechanical):** `ralph doctor` output includes a line about `## Motivation` sections. Verify with
    `ralph doctor | grep -i motivation`.
  - **SC-3 (Regression):** `ralph review --dry-run` (no `--intent`) output is unchanged from v0.5. Verify
    by diffing against baseline prompt or checking that "Problem Context" does NOT appear.
  - **SC-4 (Regression):** All 989 pre-existing tests pass. New tests bring total higher.
  - **F-IV01:** `ralph init` creates `docs/product-specs/index.md` mentioning `## Motivation`.
  - **F-IV02:** `extractMotivation()` unit tests: 8 cases all green.
  - **F-IV03:** `generateReviewPrompt()` unit tests: 5 cases all green, including empty-motivations notice.
  - **F-IV04:** `ReviewOptions.intent` and `ReviewContext.motivations` exist; CLI help shows `--intent`.
  - **F-IV05:** Doctor check appears in output; missing-Motivation spec → `pass: false`; `--ci` unaffected.

  Sentinel check — confirm Phase 4 sentinel is satisfied:
  ```
  grep -i "Motivation" src/commands/review/prompts.ts
  ```
  Must return a match (the `INTENT_REVIEW_TEMPLATE` constant contains "Motivation").
