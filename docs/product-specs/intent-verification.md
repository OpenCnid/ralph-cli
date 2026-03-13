# Spec: Intent Verification

**Version:** 1.0.0
**Status:** Draft (revised)
**Date:** 2026-03-13
**Roadmap:** Trust Calibration Phase 4
**Previous Version:** 0.8.0

---

## Changelog (v0.8.0 → v1.0.0)

| Section | Change | Reason |
|---------|--------|--------|
| Problem Statement | Rewritten with quantified impact | v0.8.0 described the problem conceptually but lacked concrete failure evidence or measurable impact |
| Design Principles | Added (new section) | Missing from v0.8.0; every other spec in this project has design principles |
| Definitions | Added (new section) | v0.8.0 used "intent," "motivation," "spec compliance" without defining them |
| Architecture | Rewritten with data flow, type definitions, config schema | v0.8.0 had only a "Changed Files" table; no data flow, no types, no config additions |
| Features | Reformatted with IDs (F-IV01–F-IV05), success criteria, edge cases, delegation safety | v0.8.0 had acceptance criteria but no feature IDs, no edge cases, no delegation guards |
| Implementation Sequence | Added (new section) | Missing from v0.8.0 |
| Feature Tracker | Added (new section) | Missing from v0.8.0 |
| Test Plan | Expanded with specific test descriptions | v0.8.0 had one-line bullet points |
| Compatibility Notes | Added (new section) | Required for revisions per spec conventions |

---

## Problem Statement

Ralph's build loop validates spec compliance: does the implementation match the spec's requirements? This check assumes that correct requirements ⟹ correct implementation. But specs are imperfect translations of intent. A requirement like "add rate limiting to the login endpoint" can be satisfied by code that:

- Rate limits by IP (technically correct, but the concern was credential stuffing per-account)
- Uses a fixed window (meets the requirement, but a sliding window was the actual intent)
- Applies globally (spec didn't say per-user, so the agent scoped globally)

The builder agent satisfies every checkbox and the tests pass. The implementation doesn't solve the underlying problem.

**Quantified impact:** In ralph-cli's own development, 3 of the first 18 failure catalog entries (F003 scope mismatch, F007 wrong abstraction level, F011 literal-interpretation) trace to agents satisfying literal requirements while missing the underlying purpose. That's a 17% rate of intent-vs-requirement misalignment in a project where specs are written carefully. Projects with weaker specs will see higher rates.

**Root cause:** Specs encode *what* to build but not *why* it's being built. Review prompts verify requirement satisfaction, not problem-solution fit. Without a "why" anchor in the spec and a "does this solve the why?" check in review, there is no mechanism to catch implementations that are correct-but-wrong.

**What this spec adds:** Two things — (1) a convention for specs to include motivation alongside requirements, and (2) a review mode that evaluates implementation against motivation rather than requirements.

---

## Design Principles

1. **Opt-in, not mandatory.** Intent review is a separate flag (`--intent`), not part of the default review flow. Motivation sections are a doctor warning, not an error. Projects adopt intent verification when they're ready.

2. **Motivation is prose, not structure.** The `## Motivation` section is free-form text describing the problem. Ralph doesn't parse it, template it, or assess its quality. The human writes the "why"; the reviewing agent reads it.

3. **Review, don't gate.** Intent verification produces qualitative feedback (APPROVE / CONCERNS / REQUEST_CHANGES), not a score or a pass/fail gate. It influences human judgment, not automated decisions.

4. **Reuse existing infrastructure.** Intent review uses the same agent resolution, context assembly, and output formatting as standard review. The only difference is the prompt template.

5. **Backward-compatible.** Projects without motivation sections work exactly as before. `ralph review` (without `--intent`) is unchanged. `ralph doctor` gains a warning-severity check, never an error.

---

## Definitions

| Term | Definition |
|------|------------|
| **Intent** | The underlying problem a spec exists to solve. Not the requirements themselves, but the reason the requirements were written. |
| **Motivation section** | A `## Motivation` heading in a spec file containing prose that describes the problem, the user pain, and what success looks like — independent of specific requirements. |
| **Intent review** | A review mode (`ralph review --intent`) that evaluates implementation against the motivation section rather than against specific requirements. |
| **Spec compliance review** | The default `ralph review` behavior: evaluating implementation against requirements, architecture, and rules. |
| **Motivation extraction** | The process of finding and returning the text between `## Motivation` and the next same-or-higher-level heading in a spec file. |

---

## Architecture

### File Locations

```
src/commands/review/
├── index.ts      — reviewCommand(): adds --intent path (MODIFIED)
├── context.ts    — extractMotivation(), updates to assembleContext() (MODIFIED)
├── prompts.ts    — INTENT_REVIEW_TEMPLATE, generateReviewPrompt() updated (MODIFIED)
└── types.ts      — intent field added to ReviewOptions and ReviewContext (MODIFIED)

src/commands/doctor/
└── checks.ts     — motivation section check added to runContentChecks() (MODIFIED)

src/commands/init/
└── templates.ts  — productSpecsIndexMd() updated with Motivation convention (MODIFIED)
```

### No New Files

Intent verification is a prompt variant, a context extraction function, and a doctor check. No new modules.

### Data Flow — `ralph review --intent`

```
1. CLI parses --intent flag → ReviewOptions.intent = true
2. reviewCommand() calls resolveScope() and extractDiff() (unchanged)
3. reviewCommand() calls assembleContext() with intent: true
4. assembleContext() calls findRelevantSpecs() (unchanged)
5. assembleContext() calls extractMotivation() on each loaded spec
6. ReviewContext now has motivations: string[] (one per spec with a ## Motivation section)
7. generateReviewPrompt() receives intent: true → uses INTENT_REVIEW_TEMPLATE
8. INTENT_REVIEW_TEMPLATE includes {motivations_content} instead of full specs
9. Agent is spawned with the intent-focused prompt
10. Output formatting is identical to standard review
```

### Type Definitions

**Changes to `src/commands/review/types.ts`:**

```typescript
export interface ReviewOptions {
  // ... existing fields ...
  intent?: boolean | undefined;  // NEW — --intent flag
}

export interface ReviewContext {
  // ... existing fields ...
  motivations: string[];         // NEW — extracted ## Motivation sections
}
```

**No config schema changes.** Intent review is a prompt variant controlled by a CLI flag. There is no `review.intent` config section. If demand emerges for config-level intent defaults, that's a future revision.

### Layer Rules

No new cross-command exceptions. All changes are within existing domains (`review`, `doctor`, `init`). The existing `review → run/agent` exception is unchanged.

---

## Features

### F-IV01: Spec Template Motivation Convention

**Goal:** Establish a convention that spec files include a `## Motivation` section describing why the feature exists.

**One-time.** Template change, no ongoing runtime behavior.

**Procedure:**
1. Update `productSpecsIndexMd()` in `init/templates.ts` to include the `## Motivation` convention in the spec format description.
2. The convention text states: each spec should include a `## Motivation` section between the title and `## Requirements` (or equivalent). The section describes the problem being solved, not the solution.

**Edge cases:**
- Existing specs don't have Motivation sections → no action. Doctor check (F-IV05) flags them. Adoption is gradual.
- Spec has a `## Motivation` section but it's empty → passes the doctor check (presence, not quality). Per Design Principle 2.

**Delegation safety:** Low risk. Template-only change. Sub-agent could over-engineer the template — constrain to adding ≤5 lines to the existing convention description.

**Success criteria:**
- ⚙️ Mechanical: `ralph init` in a fresh directory → `docs/product-specs/index.md` mentions `## Motivation` as a recommended section.

---

### F-IV02: Motivation Extraction

**Goal:** Extract the `## Motivation` section from a spec file as a standalone string.

**Ongoing.** Used by intent review on every invocation.

**Procedure:**
1. Add `extractMotivation(specContent: string): string | null` to `context.ts`.
2. The function finds the first `## Motivation` heading (case-insensitive match on the word "motivation").
3. It returns all text between that heading and the next heading of equal or higher level (`##` or `#`), or end-of-file.
4. Returns `null` if no Motivation heading is found.
5. Leading/trailing whitespace is trimmed from the result.

**Edge cases:**
- Spec has `## Motivation` but the section is only whitespace → returns `null` (treated as absent).
- Spec has `### Motivation` (h3 instead of h2) → not matched. Only `## Motivation` counts. This prevents false matches from subsections.
- Spec has multiple `## Motivation` headings → first one wins.
- Heading has extra text: `## Motivation & Context` → matched (contains "motivation").
- Heading is `## Non-Goals` followed later by `## Motivation` → matched (function scans the whole file).

**Delegation safety:** Pure function, no side effects, no I/O. Safe to delegate. Test thoroughly — regex edge cases are confabulation magnets.

**Success criteria:**
- ⚙️ Mechanical: `extractMotivation("# Spec\n## Motivation\nWhy this exists.\n## Requirements\n...")` returns `"Why this exists."`.
- ⚙️ Mechanical: `extractMotivation("# Spec\n## Requirements\n...")` returns `null`.
- ⚙️ Mechanical: `extractMotivation("# Spec\n## Motivation\n   \n## Next")` returns `null` (whitespace-only).

---

### F-IV03: Intent Review Prompt

**Goal:** When `--intent` is passed, generate a review prompt focused on motivation-vs-implementation alignment instead of requirement-checkbox satisfaction.

**Ongoing.** Core feature of intent verification.

**Procedure:**
1. Add `INTENT_REVIEW_TEMPLATE` to `prompts.ts`. The template includes:
   - Project name and architecture context (same as standard review)
   - `{motivations_content}` placeholder — the extracted motivation sections
   - `{diff_stat}` and `{diff_content}` placeholders (same as standard review)
   - Intent-specific review instructions (see template below)
2. Update `generateReviewPrompt()` to accept an `intent` option. When true, use `INTENT_REVIEW_TEMPLATE`. When false, use `REVIEW_TEMPLATE` (unchanged).
3. The intent review instructions focus on:
   - Does this implementation solve the problem described in the motivation?
   - Common intent mismatches: wrong scope, wrong abstraction, symptom-not-cause, literal interpretation
   - Ignore whether specific requirements are satisfied — focus on problem-solution fit
4. If no motivations were found (all specs lack `## Motivation`), the prompt includes a notice: "No motivation sections found in relevant specs. Review will focus on general implementation quality."

**Intent review template:**

```
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

End with: APPROVE, REQUEST_CHANGES, or CONCERNS.
```

**Edge cases:**
- `--intent --diff-only` → architecture and rules are omitted, but motivations are still included (motivations are the core input for intent review).
- `--intent` with no relevant specs found → motivations_content is "(No specs matched the changed files.)" The review becomes a general intent assessment without specific motivation anchoring.
- `--intent` with relevant specs but none have Motivation sections → motivations_content is "(No motivation sections found in relevant specs. Review will focus on general implementation quality against the diff.)"
- Multiple specs matched, some with and some without Motivation → only specs with Motivation sections are included in motivations_content.

**Delegation safety:** Medium risk. The template text is critical — sub-agent might add excessive instructions or contradict design principles. Pin the template text exactly as specified. The `generateReviewPrompt()` changes are mechanical (add a branch).

**Success criteria:**
- ⚙️ Mechanical: `generateReviewPrompt(context, { diffOnly: false, intent: true })` returns a string containing "Problem Context" and the motivation text.
- ⚙️ Mechanical: `generateReviewPrompt(context, { diffOnly: false, intent: false })` returns the standard review prompt (unchanged from v0.5).
- ⚙️ Mechanical: When `context.motivations` is empty, the prompt contains the "no motivation sections" notice.
- ✅ Immediate: `ralph review --intent --dry-run` on a codebase with motivation-bearing specs prints a prompt with the motivation text visible.

---

### F-IV04: `--intent` CLI Wiring

**Goal:** Wire the `--intent` flag through CLI parsing → reviewCommand → context assembly → prompt generation.

**One-time.** Plumbing change.

**Procedure:**
1. Add `--intent` option to the `ralph review` command in `cli.ts`.
2. Add `intent?: boolean` to `ReviewOptions` in `types.ts`.
3. In `reviewCommand()` (index.ts):
   a. Pass `intent: options.intent ?? false` to `assembleContext()`.
   b. After assembleContext returns, if `intent` is true, call `extractMotivation()` on each spec string in `reviewContext.specs` and populate `reviewContext.motivations`.
   c. Pass `intent: options.intent ?? false` to `generateReviewPrompt()`.
4. In `assembleContext()`: add `motivations: []` to the returned `ReviewContext`. Population happens in `reviewCommand()` after context assembly (keeps assembleContext focused on its existing responsibility).

**Edge cases:**
- `--intent` combined with all other existing flags (`--scope`, `--agent`, `--model`, `--format`, `--output`, `--dry-run`, `--verbose`, `--diff-only`) → all combinations work. Intent only changes the prompt template and motivation extraction.

**Delegation safety:** Low risk. Mechanical plumbing. The only judgment call is where motivation extraction happens (in reviewCommand, not assembleContext) — specify this explicitly to prevent the sub-agent from restructuring context.ts.

**Success criteria:**
- ⚙️ Mechanical: `ralph review --intent` passes `intent: true` through to `generateReviewPrompt()`.
- ⚙️ Mechanical: `ReviewOptions` type includes `intent?: boolean`.
- ⚙️ Mechanical: `ReviewContext` type includes `motivations: string[]`.
- ⚙️ Mechanical: CLI help text for `ralph review` lists `--intent` as an option.

---

### F-IV05: Doctor Check for Motivation Sections

**Goal:** `ralph doctor` flags spec files that lack a `## Motivation` section.

**Ongoing.** Runs every time `ralph doctor` executes.

**Procedure:**
1. Add a new check to `runContentChecks()` in `doctor/checks.ts`.
2. The check scans all `.md` files in the configured specs path (`config.paths.specs`).
3. For each spec file, read its content and check for a `## Motivation` heading (case-insensitive match on "motivation", same pattern as `extractMotivation()`).
4. Report results:
   - If all specs have Motivation: `pass: true`, detail: `"All N spec(s) have ## Motivation sections"`.
   - If some specs lack Motivation: `pass: false`, detail: `"M of N spec(s) missing ## Motivation section: [filenames]"`.
   - If no spec files exist: `pass: true`, detail: `"No spec files found"` (nothing to check).
5. Category: `content`. Name: `"Spec files have ## Motivation sections"`.
6. Fix suggestion: `"Add a ## Motivation section to each spec describing why the feature exists."`.
7. **Severity: warning.** This check does NOT contribute to the `--ci` failure threshold. The doctor scoring system already distinguishes pass/fail for its numeric score, but this check should never block CI on its own. Implementation: the check can fail (pass: false) which affects the doctor score, but `--ci` exit code is controlled by the minimum-score threshold, not individual check pass/fail. No special handling needed — the existing scoring system handles this correctly as long as the threshold is reasonable.

**Edge cases:**
- Spec file is `index.md` or `references.md` (metadata files, not real specs) → included in the check. If this produces false positives, a future revision can add an exclude list. For now, those files should have motivation too (or be excluded from the specs directory).
- Spec file has `## Motivation` but it's empty → passes the check (presence, not quality).
- Specs directory doesn't exist → check returns pass with "No spec files found".

**Delegation safety:** Low risk. Pattern matches the existing doctor check style exactly. The sub-agent should study existing checks in `runContentChecks()` and follow the same structure.

**Success criteria:**
- ⚙️ Mechanical: `ralph doctor` output includes a line about motivation sections.
- ⚙️ Mechanical: A spec without `## Motivation` causes the check to report `pass: false`.
- ⚙️ Mechanical: A spec with `## Motivation` causes the check to report `pass: true`.
- ⚙️ Mechanical: `ralph doctor --ci` does not exit non-zero solely because of missing motivation sections (assuming other checks pass and score is above threshold).

---

## Non-Goals

- **Automatic intent verification in the run loop.** Intent review is a manual command. Adding another LLM call to every iteration is expensive and slows the loop. If calibration tracking (Phase 3) detects trust drift, it can *suggest* running `ralph review --intent`.
- **Intent scoring.** Intent review produces qualitative output (APPROVE / CONCERNS / REQUEST_CHANGES), not a numeric score. Quantifying "intent alignment" would require ground truth data that doesn't exist.
- **Spec generation from motivation.** Ralph doesn't auto-generate requirements from motivation. Writing requirements is the developer's job.
- **Motivation quality assessment.** Ralph checks for the *presence* of a motivation section, not its *quality*. A one-line motivation passes the doctor check. Quality is a human concern.
- **Config-level intent defaults.** No `review.intent: true` config option in this version. `--intent` is always a CLI flag. If demand emerges, a future revision can add config defaults.

---

## Implementation Sequence

| Order | Feature | Depends On | Effort | Notes |
|-------|---------|------------|--------|-------|
| 1 | F-IV02: Motivation Extraction | None | Small | Pure function, tests first. Foundation for F-IV03 and F-IV04. |
| 2 | F-IV03: Intent Review Prompt | F-IV02 | Small | Template + branch in generateReviewPrompt(). |
| 3 | F-IV04: `--intent` CLI Wiring | F-IV02, F-IV03 | Small | Plumbing through CLI → command → context → prompt. |
| 4 | F-IV05: Doctor Check | None (independent) | Small | Can be implemented in parallel with 1–3. |
| 5 | F-IV01: Spec Template Convention | None (independent) | Trivial | Template text update. Can be done anytime. |

**Total estimated effort:** Small. All features are modifications to existing files, no new modules, no new dependencies. A focused sub-agent session should complete all 5 features in 3–5 iterations.

**Migration steps:** None. This is greenfield implementation — no existing behavior to migrate from.

**Independent features:** F-IV05 (doctor check) and F-IV01 (template convention) can be implemented independently of the review features. F-IV02 → F-IV03 → F-IV04 have a strict dependency chain.

---

## Feature Tracker

| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| F-IV01 | Spec Template Motivation Convention | ❌ | Template text update |
| F-IV02 | Motivation Extraction | ❌ | `extractMotivation()` in context.ts |
| F-IV03 | Intent Review Prompt | ❌ | `INTENT_REVIEW_TEMPLATE` in prompts.ts |
| F-IV04 | `--intent` CLI Wiring | ❌ | Types + CLI + reviewCommand plumbing |
| F-IV05 | Doctor Check for Motivation | ❌ | New check in doctor/checks.ts |

---

## Success Criteria (Spec-Level)

1. ✅ **Immediate:** `ralph review --intent --dry-run` on a repo with motivation-bearing specs prints a prompt that includes the motivation text and intent-specific review instructions.
2. ⚙️ **Mechanical:** `ralph doctor` reports the presence/absence of `## Motivation` sections in spec files.
3. ⚙️ **Mechanical:** `ralph review` (without `--intent`) produces identical output to v0.5. (Regression criterion.)
4. ⚙️ **Mechanical:** All existing tests (832 as of v0.5.0) continue to pass after implementation. (Regression criterion.)
5. 📏 **Trailing:** After adding `## Motivation` to ralph-cli's own specs and running `ralph review --intent` on 5 real changes, at least 2 reviews surface insights that the standard review did not.

---

## Test Plan

### Unit Tests — `context.test.ts` (additions)

| Test | Description |
|------|-------------|
| `extractMotivation returns section content` | Input with `## Motivation\nContent\n## Next` → returns `"Content"` |
| `extractMotivation returns null when absent` | Input without Motivation heading → returns `null` |
| `extractMotivation returns null for whitespace-only` | Input with `## Motivation\n   \n## Next` → returns `null` |
| `extractMotivation handles end-of-file` | Input with `## Motivation\nContent` (no next heading) → returns `"Content"` |
| `extractMotivation is case-insensitive` | Input with `## MOTIVATION\nContent\n## Next` → returns `"Content"` |
| `extractMotivation ignores h3 headings` | Input with `### Motivation\nContent` → returns `null` |
| `extractMotivation matches first occurrence` | Two `## Motivation` headings → returns content from the first |
| `extractMotivation matches partial heading` | `## Motivation & Context\nContent\n## Next` → returns `"Content"` |

### Unit Tests — `prompts.test.ts` (new file)

| Test | Description |
|------|-------------|
| `intent=false returns standard template` | `generateReviewPrompt(ctx, { diffOnly: false, intent: false })` → contains "Spec compliance" language |
| `intent=true returns intent template` | `generateReviewPrompt(ctx, { diffOnly: false, intent: true })` → contains "Problem Context" |
| `intent=true with motivations includes motivation text` | `ctx.motivations = ["Prevent credential stuffing"]` → prompt contains that text |
| `intent=true with empty motivations includes notice` | `ctx.motivations = []` → prompt contains "No motivation sections found" |
| `intent=true diffOnly=true still includes motivations` | Motivations present even when architecture/rules are omitted |

### Unit Tests — `review.test.ts` (additions)

| Test | Description |
|------|-------------|
| `--intent flag passes intent=true to generateReviewPrompt` | Mock chain verifies intent option reaches prompt generation |
| `--intent --dry-run prints intent prompt` | Dry run output uses intent template |
| `without --intent, intent defaults to false` | Existing default behavior preserved |

### Unit Tests — `cli.test.ts` (additions)

| Test | Description |
|------|-------------|
| `parses --intent` | `ralph review --intent` → options.intent === true |
| `--intent combines with all other flags` | Full flag combination parses correctly |

### Unit Tests — `doctor.test.ts` (additions)

| Test | Description |
|------|-------------|
| `flags specs missing ## Motivation` | Spec without Motivation → check.pass === false |
| `passes specs with ## Motivation` | Spec with Motivation → check.pass === true |
| `passes when no spec files exist` | Empty specs dir → check.pass === true |
| `reports filenames of missing specs` | Detail string includes the filename(s) |

---

## Compatibility Notes

**For consumers of `ralph review`:**
- `ralph review` (without `--intent`) is completely unchanged. Same prompt, same output, same behavior.
- `ralph review --intent` is additive — a new flag that produces a different prompt. No existing flags change meaning.
- Output format (text/json/markdown) works identically for intent reviews.

**For consumers of `ReviewContext` type:**
- New required field: `motivations: string[]`. Any code constructing `ReviewContext` must include this field. In practice, only `reviewCommand()` constructs this type, so impact is limited to test mocks.

**For consumers of `ralph doctor`:**
- One new check appears in doctor output. The doctor score may change slightly (denominator increases by 1). Projects at the `minimum-score` boundary should verify they still pass.

**For spec authors:**
- No spec changes required. The `## Motivation` convention is opt-in. Specs without it continue to work; they'll get a doctor warning.

---

## Diff Summary (v0.8.0 → v1.0.0)

| Section | Status |
|---------|--------|
| Problem Statement | **Revised** — quantified impact, cited failure catalog entries |
| Design Principles | **Added** — 5 principles |
| Definitions | **Added** — 5 terms |
| Design (old section) | **Deprecated** → replaced by Architecture + Features |
| Architecture | **Revised** — data flow, type definitions, layer rules |
| Features | **Revised** — 5 features with IDs, edge cases, success criteria |
| Non-Goals | **Revised** — added 1 non-goal (config-level defaults) |
| Implementation Sequence | **Added** |
| Feature Tracker | **Added** |
| Acceptance Criteria (old) | **Deprecated** → replaced by per-feature success criteria + spec-level criteria |
| Test Plan | **Revised** — expanded from 6 bullets to 21 specific tests |
| Compatibility Notes | **Added** |

---

## Self-Review — Issues Found and Fixed

### Pass 1: Structural

| # | Issue | Fix |
|---|-------|-----|
| 1 | v0.8.0 had no Definitions section — terms used inconsistently | Added Definitions with 5 terms |
| 2 | v0.8.0 Architecture was a file change table, not a data flow | Rewrote with 10-step data flow, type definitions, layer rules |
| 3 | v0.8.0 had no Implementation Sequence | Added dependency-ordered sequence with effort estimates |
| 4 | v0.8.0 had no Feature Tracker | Added tracker with 5 features, all at ❌ |
| 5 | Regression criteria missing | Added spec-level criteria #3 and #4 explicitly as regression checks |
| 6 | No Compatibility Notes | Added section covering all consumer categories |

### Pass 2: Semantic

| # | Issue | Fix |
|---|-------|-----|
| 7 | v0.8.0 used "appropriate" and "relevant" without specifics (e.g., "relevant spec(s)") | Replaced with concrete references to `findRelevantSpecs()` function and `config.paths.specs` |
| 8 | "Motivation section check" in doctor was underspecified — what counts as "having" a section? | Defined: heading presence (case-insensitive), whitespace-only counts as absent for extraction but present for doctor |
| 9 | v0.8.0 said intent review "includes the full text of the Motivation section" but didn't specify extraction logic | Added F-IV02 with regex specification, edge cases for h3/h2 distinction, multi-heading, and EOF |
| 10 | Implicit assumption that `--intent` would work with the existing `assembleContext()` unchanged | Made explicit: assembleContext returns empty `motivations: []`, population happens in reviewCommand |
| 11 | "Doctor check doesn't fail CI" was vague about mechanism | Clarified: existing scoring system handles this; no special handling needed |

### Pass 3: Adversarial

| # | Issue | Fix |
|---|-------|-----|
| 12 | **Confabulation (F002):** Sub-agent could claim intent review "works" by testing only the happy path (motivation present, specs found) | Added 4 edge-case scenarios to F-IV03 with specific success criteria for each |
| 13 | **Duplicate implementation (F012):** Sub-agent might create a new `intentContext.ts` file instead of modifying existing `context.ts` | Spec explicitly states "No New Files" and specifies which existing files to modify |
| 14 | **Plan vandalism (F013):** Feature tracker could be overwritten during implementation | All features start at ❌; tracker format matches established convention; no ✅ to revert |
| 15 | **Regression:** Existing review tests depend on `ReviewContext` shape | Compatibility Notes warn that `motivations: string[]` must be added to test mocks |
| 16 | **Context loss:** Sub-agent implementing F-IV04 might not know F-IV02 was already done | Implementation Sequence specifies strict ordering; F-IV04 procedure step 3b references `extractMotivation()` by name |
| 17 | **Scope creep:** Sub-agent might add config schema for intent defaults ("while we're here") | Non-Goals explicitly excludes config-level intent defaults with rationale |
| 18 | **Stale references:** Spec references `assembleContext()` and `generateReviewPrompt()` — these exist in the current codebase and won't be renamed by this revision | Verified: both functions exist as named, revision only adds parameters |

---

## Migration Risk Assessment

**LOW.**

Rationale:
- No existing behavior changes. All features are additive.
- No config schema changes. No migration of data formats.
- No new dependencies. No new files.
- All 832 existing tests should pass unchanged (only test mock shapes need `motivations: []`).
- Rollback is trivial: revert the commits.

---

## Remaining Risks

1. **Motivation extraction regex may have edge cases not covered.** The spec defines 8 test cases, but markdown heading parsing is notoriously tricky (e.g., headings inside code blocks). Mitigation: the extraction function uses a simple line-by-line scan, not a full markdown parser. Code-block headings are an accepted false positive at this scope.

2. **Intent review quality depends entirely on the LLM's ability to reason about problem-solution fit.** The prompt template is well-structured, but this is an inherently subjective judgment. Trailing success criterion #5 will measure real-world effectiveness.

3. **Doctor score impact.** Adding one more check changes the denominator. Projects exactly at `minimum-score` threshold may need adjustment. Low risk — the check is a warning, and the score change is at most 1 point on a ~30-point scale.
