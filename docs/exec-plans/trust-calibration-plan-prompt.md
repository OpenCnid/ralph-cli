<!-- Template Placeholder Contract
Placeholders: {project_name}, {date}, {language}, {framework}, {project_path},
              {src_path}, {specs_path}, {validate_command}, {test_command},
              {typecheck_command}, {skip_tasks}
Contract version: 2
Consumers: src/commands/run/prompts.ts (loaded via run.prompts.plan config)
Revision: 2026-03-13 -- hardened via Meta-Prompt v2
-->
# Planning Session — Trust Calibration

**Project:** {project_name}
**Date:** {date}
**Language:** {language}
**Framework:** {framework}
**Project Path:** {project_path}
**Source Path:** {src_path}
**Specs Path:** {specs_path}

## Validation

Run this before finishing to confirm the codebase is in a good state:
```
{validate_command}
```
(Individual commands: test — `{test_command}`, typecheck — `{typecheck_command}`)

> **Forward-compat note:** After Phase 1 (Staged Validation), the composed
> validate command above is replaced by a staged pipeline. If Phase 1 is
> already complete, use `ralph run --dry-run` to see the current stage list
> instead of the composed command.

## Context: Multi-Phase Feature Roadmap

You are planning implementation for the Trust Calibration roadmap — a set of
5 features that evolve ralph-cli from a failure catcher into a trust calibrator.

**Read the roadmap first:**
`{specs_path}/trust-calibration-roadmap.md`

The roadmap defines 5 phases in strict dependency order. You will plan **only
the next incomplete phase**. Never plan ahead.

## Phase Detection

Determine the current phase by checking for **sentinel files** — specific source
files whose existence proves a phase is implemented. Run these checks and **show
the output** (do not assume — verify):

| Check | File exists? | Means |
|-------|-------------|-------|
| Phase 1 done | `src/commands/run/stages.ts` | Staged validation is implemented |
| Phase 2 done | `src/commands/run/adversarial.ts` | Adversarial generation is implemented |
| Phase 3 done | `src/commands/score/calibration.ts` | Calibration tracking is implemented |
| Phase 4 done | Intent review template in `src/commands/review/prompts.ts` containing "Motivation" | Intent verification is implemented |
| Phase 5 done | `src/commands/gc/fingerprint.ts` | Approach divergence is implemented |

Check each sentinel in order. The first missing one is your target phase.
If all are present, output: "All phases implemented. No planning needed." and stop.

**Edge case — partial implementation:** If a sentinel file exists but validation
fails (tests break, typecheck errors), the phase is **incomplete**. Do NOT advance
to the next phase. Instead, add fix tasks to complete the current phase before
planning new work.

> Sentinel files are defined in the roadmap. If a phase spec changes the sentinel
> path, update this table.

## Phase Specs

Each phase has a dedicated spec with acceptance criteria:

| Phase | Spec | Feature |
|-------|------|---------|
| 1 | `{specs_path}/staged-validation.md` | Multi-stage validation pipeline |
| 2 | `{specs_path}/adversarial-generation.md` | Post-pass adversarial test generation |
| 3 | `{specs_path}/calibration-tracking.md` | Trust drift detection via rolling metrics |
| 4 | `{specs_path}/intent-verification.md` | Spec motivation cross-referencing |
| 5 | `{specs_path}/approach-divergence.md` | Temporal pattern fingerprinting |

## Planning Instructions

### Step 1 — Detect current phase

Check the sentinel files above. Identify which phase to plan. Show the check
results explicitly — do not skip this step or assume based on other evidence.

### Step 2 — Read the phase spec

Read the spec file for your target phase **completely**. Pay close attention to:
- The **Architecture** section (which files to create, which to change)
- The **Acceptance Criteria** (every AC must map to at least one task)
- The **Non-Goals** (do not plan work outside spec scope)
- The **Layer Rules** (respect import restrictions)

### Step 3 — Read the existing code

Read the source files listed in the spec's "Changed Files" table. Understand
what exists today so your tasks describe precise, scoped changes — not vague
directives.

For new files listed in "New Files," read the neighboring files in the same
domain to understand conventions (naming, exports, test patterns).

**Critical for migration:** When the spec modifies an existing function's return
type or signature, identify ALL call sites. List them. The plan must update every
consumer — missing one means a broken build.

### Step 4 — Read the architecture

Read `ARCHITECTURE.md` for:
- Current domain list and layer order
- Cross-command exception policy (documented exceptions are allowed, new ones must be noted)
- File size limits and naming conventions

### Step 5 — Validate the current state

Run:
```
{validate_command}
```
Note any pre-existing failures. These must be resolved before new work begins
— add a fix task at the top of the plan if needed.

**Regression baseline:** Also capture these quantitative baselines for later
comparison. Record them in the plan's Pre-flight section:
- Total test count (from test output)
- Test pass rate
- Typecheck status (clean or N errors)

These baselines verify that the implementation doesn't regress existing
functionality (required by every phase spec's backward-compatibility criteria).

### Step 6 — Write IMPLEMENTATION_PLAN.md

Create `IMPLEMENTATION_PLAN.md` at the project root. Structure:

```markdown
# Implementation Plan — Trust Calibration Phase N

Spec: `{specs_path}/[spec-file].md`
Date: [today]

## Pre-flight
- [ ] Fix any pre-existing validation failures (if applicable)
- Regression baseline: [test count] tests passing, typecheck clean

## Schema & Config
- [ ] Add [TypeName] to src/config/schema.ts
  [What fields, which AC it satisfies]

- [ ] Add defaults for [config section] in src/config/defaults.ts
  [Default values per spec]

## Config Validation
- [ ] Add validation rules for [config section] in src/config/validate.ts
  [Validation rules: type checks, range constraints, unknown-key warnings]
  [Update KNOWN_RUN_VALIDATION_KEYS or equivalent constant]
  [This task may combine with Schema & Config if all 3 files are
   tightly coupled — see Rule 1 exception]

## Core Implementation
- [ ] Create src/commands/[domain]/[file].ts
  [Responsibility, key functions, which AC it satisfies]

- [ ] Modify src/commands/[domain]/[existing-file].ts
  [What changes, why, which AC]

[... one task per focused change ...]

## Migration
- [ ] Update return type consumers in [file].ts
  [List every call site that uses the old interface.
   Update each to handle the new interface shape.]
  [This task exists because the spec changes an existing interface.
   Omit if the phase only adds new files.]

## Integration
- [ ] Wire into run loop / CLI entry point
  [Where the integration point is, which AC]

- [ ] Update ARCHITECTURE.md with new files and any cross-command exceptions
  [What to add]

## Tests
- [ ] Unit tests for [module]
  [What to test, which AC is verified]

- [ ] Integration test for [workflow]
  [What end-to-end behavior to verify]

## Backward Compatibility
- [ ] Verify backward compatibility
  [Run validation with NO explicit stages config.
   Confirm behavior is identical to v0.5 baseline.
   Compare test count, pass rate against pre-flight baseline.]

## Verification
- [ ] Run full validation and verify all Phase N acceptance criteria
  Cross-check each AC from the spec. List them explicitly:
  - AC-1: [name] — verify [how]
  - AC-2: [name] — verify [how]
  [... all ACs ...]
```

### Migration Safety

When a phase modifies an existing function, type, or interface:

1. **Modify in-place.** Do not create a parallel implementation (e.g., do not
   create `runStagedValidation()` alongside `runValidation()`). Modify the
   existing function to support both old and new behavior. This prevents
   F012 (Duplicate Implementation).

2. **Sequence for compilability.** Schema changes → implementation →
   integration → tests. Never leave the codebase in a state where types are
   defined but not consumed, or consumers reference types that don't exist yet.

3. **Update ALL consumers.** When a return type changes, the plan must include
   an explicit task to update every call site. Use grep/search to find them —
   do not rely on memory.

4. **Never revert completed work.** Do not change a `[x]` to `[ ]` in the plan.
   If completed work needs revision, create a NEW task (e.g., "Revise [original
   task name] to handle [edge case]"). This prevents F013 (Plan Vandalism).

### Known Failure Patterns

These failure patterns from the project's failure catalog are relevant to
planning. Keep them in mind while authoring tasks:

- **F002 — Agent Confabulation:** Agents claim work is done without verifying.
  Mitigation: every task's description should state how to verify completion,
  not just what to build.
- **F012 — Duplicate Implementation:** Agents create new functions instead of
  modifying existing ones. Mitigation: Migration Safety rule 1 above.
- **F013 — Plan Vandalism:** Agents rewrite the plan, losing track of completed
  work. Mitigation: Migration Safety rule 4 above.

## Task Authoring Rules

1. **One task = one focused change.** If a task touches more than 2 files,
   split it — unless the files are tightly coupled (e.g., `schema.ts` +
   `defaults.ts` + `validate.ts` form a schema triad that may be changed
   together in one task, up to 3 files).

2. **Schema before implementation.** Config types and defaults are always
   planned before the code that reads them.

3. **Implementation before integration.** Build the module, then wire it
   into the run loop or CLI.

4. **Tests after the code they test.** But in the same phase — never defer
   tests to a later phase.

5. **Verification is the last task.** It explicitly lists every AC from the
   spec and how to verify it.

6. **Map every AC.** Every acceptance criterion in the spec must appear in
   at least one task description. If an AC has no corresponding task, you
   missed something.

7. **No cross-phase work.** Do not create tasks that reference features from
   later phases. If Phase 2 depends on Phase 1's output, Phase 1's plan
   should not anticipate Phase 2's needs beyond what Phase 1's own spec requires.

8. **Backward compatibility is a task.** If the spec mentions backward
   compatibility, add an explicit task to verify it (not just a note in
   another task). Compare against the regression baseline from Step 5.

9. **Migration is a task.** If the spec modifies an existing interface (return
   type, function signature, config shape), add an explicit Migration task that
   lists every consumer and describes the update. Do not fold migration into
   the implementation task — it's too easy to miss call sites.

<!-- {skip_tasks}
     This placeholder is replaced by prompts.ts with content that tells the
     agent to skip already-completed tasks when resuming a run. It is injected
     automatically — do not remove or relocate this marker. -->
{skip_tasks}
