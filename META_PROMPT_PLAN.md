# Meta-Prompt: Fitness Scoring Implementation Planning

You are executing `ralph run plan` to generate the implementation plan for v0.5.0 (Fitness Scoring). Your output is a new section appended to `IMPLEMENTATION_PLAN.md`.

## Context

- **Project:** ralph-cli — TypeScript CLI, ESM, vitest, 685 tests, v0.4.0
- **Branch:** `feature/fitness-scoring`
- **Spec:** `docs/product-specs/fitness-scoring.md` (1,020 lines, 11 features, 77 acceptance criteria)
- **What exists:** 13 commands complete (init through heal). The run loop (`src/commands/run/`) is the primary integration target — scoring hooks into the existing loop.

## Critical Execution Rules

1. **Run detached.** Start `ralph run plan` and let it complete autonomously. Do NOT long-poll or wrap in cron. Check progress with `git log --oneline -5` periodically.
2. **One planning iteration** is expected — the plan agent reads specs, reads code, writes IMPLEMENTATION_PLAN.md, done. If plan mode produces a second identical plan, that's convergence — normal.
3. **After plan generation,** review the output for: correct task count (expect 12-18 tasks), proper dependency ordering, one-iteration-per-task sizing, coverage of all 11 features and 77 ACs.

## What the Planning Agent Must Understand

### Architecture — What Already Exists

The scoring feature touches TWO domains:

**New domain: `src/commands/score/`** (standalone `ralph score` command)
```
score/
├── index.ts          # ralph score command entry point
├── types.ts          # ScoreResult, ResultEntry, ScoreContext (DEFINED IN SPEC)
├── scorer.ts         # Score script discovery + execution
├── default-scorer.ts # Built-in scorer (test count + coverage)
├── results.ts        # results.tsv read/write/append
├── trend.ts          # Trend computation + ASCII sparkline
├── score.test.ts     # Unit tests
└── cli.test.ts       # CLI integration tests
```

**Existing domain modified: `src/commands/run/`** (4 new files + major index.ts changes)
```
run/
├── index.ts      # MODIFIED — scoring/validation/timeout/lock steps added to loop
├── types.ts      # MODIFIED — AgentResult gains timedOut, RunOptions gains 4 new fields
├── prompts.ts    # MODIFIED — {score_context} variable added to BUILD_TEMPLATE
├── progress.ts   # MODIFIED — Checkpoint gains 6 new fields
├── scoring.ts    # NEW — scoring integration for run loop
├── timeout.ts    # NEW — iteration timeout wrapper
├── validation.ts # NEW — post-agent validation runner
└── lock.ts       # NEW — run lock management
```

**Config system: `src/config/`** (all 4 files modified)
```
config/
├── schema.ts    # MODIFIED — ScoringConfig + LoopConfig.iteration-timeout + RunOptions
├── defaults.ts  # MODIFIED — DEFAULT_SCORING + DEFAULT_LOOP update
├── loader.ts    # MODIFIED — merge scoring config
└── validate.ts  # MODIFIED — validate scoring.*, iteration-timeout, weights
```

### The Spec's Type Definitions (Already Written)

The spec defines exact TypeScript interfaces for `ScoreResult`, `ResultEntry`, `ScoreContext`, and the `RunOptions` extension. The agent MUST use these exactly — do not invent alternative types.

### Existing Patterns to Follow

- **Config additions:** See how `ReviewConfig` and `HealConfig` were added in v0.3.0 and v0.4.0 — same schema→defaults→loader→validate chain.
- **Cross-domain imports:** `heal/index.ts` already imports from `run/agent.ts` and `run/detect.ts`. Same pattern for `score/` importing from `run/` where needed.
- **Test conventions:** vitest, `vi.mock()` for dependencies, `mkdtempSync` for temp dirs, `.git/` stubs, `process.chdir()` with `afterEach` cleanup. See `run/run.test.ts` for the loop test pattern.
- **Checkpoint backward compat:** New fields are optional with `undefined` default. Loader treats missing fields as absent.

### Key Dependency Chain

```
Phase 1: Foundation (must be first)
  Task: Score types (score/types.ts)
  Task: Config schema + defaults + loader + validation for scoring.*
  Task: LoopConfig.iteration-timeout addition

Phase 2: Score Command (independent of run loop changes)
  Task: Score script discovery + execution (scorer.ts)
  Task: Default scorer (default-scorer.ts)
  Task: Results log (results.ts)
  Task: Trend + sparkline (trend.ts)
  Task: ralph score CLI command (score/index.ts + cli.ts registration)

Phase 3: Run Loop Integration (depends on Phase 1 + Phase 2's scorer)
  Task: Run lock (lock.ts)
  Task: Post-agent validation (validation.ts)
  Task: Iteration timeout (timeout.ts)
  Task: Scoring integration + regression detection + auto-revert (scoring.ts)
  Task: Score context in prompts (prompts.ts modification)
  Task: Run loop orchestration (index.ts modification — THE BIG ONE)
  Task: --simplify and --no-score flags

Phase 4: Finalization
  Task: CLI flag registration (ralph run gains --no-score, --simplify, --baseline-score, --force)
  Task: ARCHITECTURE.md + domain docs for score
  Task: Version bump + CHANGELOG
```

### Task Sizing Constraints

- **One task = one focused change** completable in a single `ralph run` iteration (~5-15 min agent time)
- **The run loop modification (scoring.ts + index.ts)** is the highest-risk task. Consider splitting into: (a) scoring.ts with regression detection logic, (b) index.ts integration with the existing loop
- **Config changes** can be one task (they follow an established 4-file pattern)
- **Each Phase 2 task** is independent — one file each, no ordering required within Phase 2
- **Tests are part of each task**, not separate tasks

### What NOT to Plan

- No new npm dependencies
- No changes to existing commands other than `run`
- No changes to `ralph review` or `ralph heal`
- Scoring in plan mode (explicitly exempted in spec)
- The spec is FINAL — no new features, no architecture changes

## Validation Command

Every task should end with:
```
npm test && npx tsc --noEmit && ralph doctor --ci && ralph grade --ci
```

## Output Format

Append a new section to IMPLEMENTATION_PLAN.md following the exact format of previous versions (v0.2.0, v0.3.0, v0.4.0):

```markdown
## v0.5.0 — Fitness Scoring (`ralph score` + Run Loop Integration)

**Spec:** `docs/product-specs/fitness-scoring.md`
**Goal:** ...
**Baseline:** v0.4.0 complete. 685 tests. ...

### Task N: Title
- [ ] Detailed implementation steps
- [ ] Files: list
- [ ] Tests: what to test
- [ ] Done when: acceptance criteria reference

### Dependency Graph
(ASCII diagram)

### Validation
(Command + expected outcome)
```

## Pre-Flight Checklist

Before starting `ralph run plan`:
1. Verify branch: `git branch --show-current` → `feature/fitness-scoring`
2. Verify clean state: `npm test` → 685 passing
3. Verify spec exists: `wc -l docs/product-specs/fitness-scoring.md` → ~1020 lines
4. Verify no stale checkpoint: `rm -f .ralph/run-checkpoint.json`
