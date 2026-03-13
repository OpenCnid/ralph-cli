# Implementation Plan — Trust Calibration Phase 4

Spec: `docs/product-specs/intent-verification.md`
Date: 2026-03-13

## Pre-flight

- No pre-existing validation failures.
- Regression baseline: **989 tests** passing (40 test files), typecheck **clean**, doctor **29/29** checks passed.

---

## Types

- [x] Add `intent?: boolean | undefined` to `ReviewOptions` and `motivations: string[]` to `ReviewContext` in `src/commands/review/types.ts`; also update `assembleContext()` return in `src/commands/review/context.ts` to include `motivations: []`
  - `ReviewOptions.intent` is the CLI flag carrier (F-IV04, AC: `ReviewOptions` type includes `intent?: boolean`)
  - `ReviewContext.motivations` holds extracted motivation sections (F-IV04, AC: `ReviewContext` type includes `motivations: string[]`)
  - `assembleContext()` returns `motivations: []` — population happens in `reviewCommand()`, not here (per spec F-IV04 design)
  - Verify: `npx tsc --noEmit` passes after this task; assembleContext return is structurally valid

---

## Core Implementation

- [x] Add `extractMotivation(specContent: string): string | null` to `src/commands/review/context.ts`
  - Scan line-by-line for the first line that starts with `## ` and whose remaining text contains "motivation" (case-insensitive)
  - Only match `##` headings (exactly two hashes + space) — `###` must not match
  - Collect all lines until the next `##` or `#` heading, or end-of-file
  - Trim the collected content; return `null` if no heading found or content is only whitespace after trimming
  - Satisfies F-IV02; foundation for F-IV03 and F-IV04
  - Verify: the 8 edge cases in the spec test plan (present content, absent, whitespace-only, EOF, case-insensitive, h3 ignored, first-of-multiple, partial heading text) are all handled

- [x] Add `INTENT_REVIEW_TEMPLATE` and update `generateReviewPrompt()` in `src/commands/review/prompts.ts`
  - Add `INTENT_REVIEW_TEMPLATE` constant with the exact template text from spec F-IV03 (uses `{motivations_content}`, `{diff_stat}`, `{diff_content}`, `{project_name}`, `{architecture_content}` placeholders; no `{specs_content}` or `{rules_content}`)
  - Update `generateReviewPrompt(context, options)` — add `intent?: boolean | undefined` to the `options` type; when true, use `INTENT_REVIEW_TEMPLATE`
  - Populate `{motivations_content}`:
    - Non-empty `context.motivations`: join with `\n\n---\n\n`
    - Empty `context.motivations`: `"(No motivation sections found in relevant specs. Review will focus on general implementation quality against the diff.)"`
  - When `intent: true` and `diffOnly: true`: strip architecture sections from the intent template the same way diffOnly strips them from the standard template, but motivations remain
  - Existing callers pass `{ diffOnly: boolean }` — `intent` is optional so no callers break
  - Satisfies F-IV03
  - Verify: `npx tsc --noEmit` passes; existing review tests still pass (intent defaults to falsy)

---

## Integration

- [x] Wire `--intent` through CLI → `reviewCommand()` in `src/cli.ts` and `src/commands/review/index.ts`
  - `src/cli.ts`: add `.option('--intent', 'Evaluate implementation against spec motivations instead of requirements')` to the `ralph review` command block; add `intent?: boolean` to the options type annotation in `.action()`; pass `intent: options.intent` when calling `reviewCommand()`
  - `src/commands/review/index.ts`:
    - Pass `intent: options.intent ?? false` to `generateReviewPrompt()`
    - After `assembleContext()` returns, if `options.intent` is true: iterate `reviewContext.specs`, call `extractMotivation()` on each, push non-null results into `reviewContext.motivations`
  - Do NOT restructure `assembleContext()` — motivation extraction stays in `reviewCommand()` per spec
  - Satisfies F-IV04; all flag combinations work because intent only changes the prompt template and extraction
  - Verify: `ralph review --help` lists `--intent`; `npx tsc --noEmit` passes

- [x] Add motivation-section doctor check to `runContentChecks()` in `src/commands/doctor/checks.ts`
  - After the existing `tech-debt-tracker.md` check, add a new check:
    - Name: `"Spec files have ## Motivation sections"`
    - Category: `'content'`
    - Fix suggestion: `"Add a ## Motivation section to each spec describing why the feature exists."`
  - Scan all `.md` files in `join(projectRoot, config.paths.specs)`; use a local inline regex/loop to detect `## ` headings containing "motivation" (case-insensitive) — **do not import from review/context.ts**, that would be a cross-command violation
  - Results:
    - Dir missing or empty: `pass: true`, detail `"No spec files found"`
    - All N have Motivation: `pass: true`, detail `"All N spec(s) have ## Motivation sections"`
    - M of N missing: `pass: false`, detail `"M of N spec(s) missing ## Motivation section: [filenames]"` (list missing filenames only)
  - Satisfies F-IV05; `--ci` exit code unaffected (existing score threshold handles it)
  - Verify: `ralph doctor` output includes the motivation check line; `ralph doctor --ci` still exits 0

- [x] Update `productSpecsIndexMd()` in `src/commands/init/templates.ts`
  - In the `## Convention` block, add the Motivation convention (≤5 lines): each spec should include a `## Motivation` section between the title and `## Requirements` (or equivalent), describing the problem being solved, not the solution
  - Do not restructure the function
  - Satisfies F-IV01
  - Verify: `ralph init` in a fresh dir → generated `docs/product-specs/index.md` mentions `## Motivation`

---

## Migration

- [x] Update `ReviewContext` mock shapes in existing test files
  - `src/commands/review/review.test.ts` — every object literal satisfying `ReviewContext` (returned from mocked `assembleContext`) needs `motivations: []` added
  - `src/commands/review/context.test.ts` — every `assembleContext()` return value assertion needs `motivations: []` in the expected shape
  - Required because `motivations: string[]` is a new required field on `ReviewContext`
  - Verify: `npm test` passes after this task with no TS errors in test files

---

## Tests

- [x] Unit tests for `extractMotivation` — add to `src/commands/review/context.test.ts`
  - 8 cases per spec test plan:
    1. Returns section content between `## Motivation` and next `##` heading
    2. Returns `null` when no Motivation heading exists
    3. Returns `null` for whitespace-only section content
    4. Handles EOF (no next heading after Motivation)
    5. Case-insensitive: `## MOTIVATION` matches
    6. `###` heading does NOT match (h3 ignored)
    7. First of multiple `## Motivation` headings wins
    8. Partial heading text: `## Motivation & Context` matches
  - Verify: all 8 pass; total test count up by 8

- [x] Unit tests for `generateReviewPrompt` intent path — create `src/commands/review/prompts.test.ts`
  - 5 cases per spec test plan:
    1. `intent: false` → standard template (no "Problem Context")
    2. `intent: true` → intent template (contains "Problem Context")
    3. `intent: true` + non-empty `motivations` → motivation text appears in prompt
    4. `intent: true` + empty `motivations` → "no motivation sections" notice appears
    5. `intent: true` + `diffOnly: true` → motivations still present
  - Build a minimal `ReviewContext` fixture; pure function, no mocking needed
  - Verify: all 5 pass; `prompts.test.ts` shows up in test output

- [x] Tests for `--intent` in `reviewCommand()` — add to `src/commands/review/review.test.ts`
  - 3 cases per spec test plan:
    1. `--intent` flag → `intent: true` reaches `generateReviewPrompt()` (mock chain verification)
    2. `--intent --dry-run` → output contains "Problem Context"
    3. Without `--intent` → intent defaults to false, standard template used
  - Verify: existing 430 lines of tests still pass; 3 new tests added

- [ ] Tests for `--intent` CLI parsing — add to `src/commands/review/cli.test.ts`
  - 2 cases per spec test plan:
    1. `ralph review --intent` → `options.intent === true`
    2. `--intent` combined with `--dry-run --diff-only` → all flags parse correctly
  - Verify: existing 142 lines of tests still pass; 2 new tests added

- [ ] Tests for motivation doctor check — add to `src/commands/doctor/doctor.test.ts` (or whichever file covers `runContentChecks`)
  - 4 cases per spec test plan:
    1. Spec without `## Motivation` → `check.pass === false`
    2. Spec with `## Motivation` → `check.pass === true`
    3. Empty specs dir → `check.pass === true`, detail `"No spec files found"`
    4. Multiple specs, some missing → detail string includes missing filenames
  - Follow the same mock/fs-stub pattern as existing doctor content checks
  - Verify: all 4 pass

---

## Backward Compatibility

- [ ] Verify backward compatibility
  - Run `ralph review --dry-run` (no `--intent`) → confirm prompt contains "Spec compliance" language and NOT "Problem Context"
  - Compare test count: must be ≥ 989 + 22 = **1011** (8 extractMotivation + 5 prompts + 3 review + 2 cli + 4 doctor)
  - Run `ralph doctor --ci` → confirm exits 0 (motivation check is a warning; score threshold handles it)
  - Run `npx tsc --noEmit` → confirm clean

---

## Verification

- [ ] Run full validation and verify all Phase 4 acceptance criteria

  ```
  npm test && npx tsc --noEmit && ralph doctor --ci && ralph grade --ci
  ```

  Cross-check each AC:

  - **AC-1 (F-IV01):** `ralph init` in a fresh directory → `docs/product-specs/index.md` mentions `## Motivation`. Verify by reading the generated file.
  - **AC-2 (F-IV02):** `extractMotivation("# Spec\n## Motivation\nWhy this exists.\n## Requirements\n...")` returns `"Why this exists."`. Covered by context unit test 1.
  - **AC-3 (F-IV02):** `extractMotivation` returns `null` when heading absent. Covered by context unit test 2.
  - **AC-4 (F-IV02):** `extractMotivation` returns `null` for whitespace-only section. Covered by context unit test 3.
  - **AC-5 (F-IV03):** `generateReviewPrompt(ctx, { diffOnly: false, intent: true })` returns string containing "Problem Context" and motivation text. Covered by prompts tests 2–3.
  - **AC-6 (F-IV03):** `generateReviewPrompt(ctx, { diffOnly: false, intent: false })` returns standard prompt unchanged. Covered by prompts test 1 + backward compatibility task.
  - **AC-7 (F-IV03):** Empty `motivations` → "no motivation sections" notice in prompt. Covered by prompts test 4.
  - **AC-8 (F-IV03, immediate):** `ralph review --intent --dry-run` on a codebase with motivation-bearing specs prints motivation text and intent-specific instructions. Verify manually.
  - **AC-9 (F-IV04):** `ReviewOptions` includes `intent?: boolean`. Verified by typecheck.
  - **AC-10 (F-IV04):** `ReviewContext` includes `motivations: string[]`. Verified by typecheck.
  - **AC-11 (F-IV04):** `ralph review --help` lists `--intent`. Verify: `ralph review --help | grep intent`.
  - **AC-12 (F-IV05):** `ralph doctor` output includes a line about motivation sections. Verify by running `ralph doctor`.
  - **AC-13 (F-IV05):** Spec without `## Motivation` → `check.pass === false`. Covered by doctor test 1.
  - **AC-14 (F-IV05):** `ralph doctor --ci` exits 0 despite missing motivation sections. Verify on this repo.
  - **AC-15 (regression):** All 989 pre-Phase-4 tests continue to pass. Compare final test count.
  - **AC-16 (regression):** `ralph review` (without `--intent`) produces identical output to pre-Phase-4. Verify via dry-run.
  - **Sentinel:** `grep -l "Motivation" src/commands/review/prompts.ts` returns the file → Phase 4 complete.
