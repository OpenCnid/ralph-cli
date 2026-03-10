# Implementation Plan — ralph-cli

## Current State

- **Version**: 0.5.0
- **Commands**: All 14 implemented (init, lint, grade, gc, doctor, plan, promote, ref, hooks, ci, run, review, heal, score) + config validate.
- **Tests**: 685+ across 30+ files
- **Next**: v0.6.0 (TBD)
- **Dependencies**: Runtime: `commander`, `yaml`, `picocolors`. Dev: `typescript`, `vitest`, `eslint`, `@types/node`

### Validation Baseline (2026-03-09)

All four checks pass:
- `npm test` — 685 tests, 30 files ✅
- `npx tsc --noEmit` — clean ✅
- `ralph doctor --ci` — 10/10 (28/29 checks; `docs/exec-plans/` missing `active/` + `completed/` subdirs) ✅
- `ralph grade --ci` — exits 0; `review`/`heal` grade C (coverage file has no entries for those paths — tests are fully mocked); `ref` grade C (62% line coverage) ✅

These quality issues are non-blocking but should be resolved before v0.5.0 to maintain a clean baseline.

## Release History

| Version | Date | Summary |
|---------|------|---------|
| 0.5.0 | 2026-03-10 | `ralph score` fitness scoring + run loop hardening — script discovery, default scorer, results log, trend, run lock, auto-revert, score context in prompts |
| 0.4.0 | 2026-03-09 | `ralph heal` automated self-repair — diagnostics, heal prompt, agent orchestration, CLI registration, architecture/docs updates |
| 0.3.0 | 2026-03-09 | `ralph review` agent-powered code review — diff extraction, context assembly, prompt engine, output formats (text/json/markdown), agent reuse from run |
| 0.2.2 | 2026-03-09 | Fix `ref` domain grade — add test coverage for URL, update, list, pyproject.toml/go.mod paths (ref: C) |
| 0.2.1 | 2026-03-09 | Dogfood cleanup — per-domain docs (12 domains), GC drift resolved (5 items), version bump |
| 0.2.0 | 2026-03-09 | `ralph run` autonomous build loop — agent abstraction, prompt engine, checkpoint, auto-detect, 80+ tests |
| 0.1.1 | 2026-03-08 | Interactive init/doctor/ref, prompt utils, grade crash fix, GC orphan fix, custom YAML autofix, README + AGENTS.md |
| 0.0.28–0.0.32 | 2026-03-07 | GC git context, config schema rename (`files`→`rules`), direction field, script rules, trend reasons, spec alignment |
| 0.0.23–0.0.27 | 2026-03-06 | Doctor spec compliance, CI auto-detection, GC dedup + temporal context, Python/Go linter detection, per-dimension trends |
| 0.0.16–0.0.22 | 2026-03-04–05 | Lint --fix autofix, ref discover, pre-commit staged files, promote violation counts + escalation path, plan contextual tasks |
| 0.0.10–0.0.15 | 2026-03-03–04 | File-organization rule, GC dead code + principle violations, per-domain grading, promote format, GC category filter |
| 0.0.5–0.0.9 | 2026-03-02–03 | Staleness dimension, multi-format coverage, config validation, domain isolation, doctor enhancements |
| 0.0.1–0.0.4 | 2026-03-01 | Foundation, all 10 commands (P0–P9) |

Full details → `CHANGELOG.md`

## Command Implementation Status

| Command | Status | Tests |
|---------|--------|-------|
| `ralph init` | ✅ Complete (interactive + --defaults) | 15+ |
| `ralph lint` | ✅ Complete (5 built-in rules + custom YAML/JS + --fix) | 32+ |
| `ralph grade` | ✅ Complete (5 dimensions, per-domain, trends) | 36+ |
| `ralph gc` | ✅ Complete (4 categories, dedup, trends, custom anti-patterns) | 22+ |
| `ralph doctor` | ✅ Complete (structure/content/backpressure/ops, --fix) | 16+ |
| `ralph plan` | ✅ Complete (create/status/complete/abandon/list, --json) | 10+ |
| `ralph promote` | ✅ Complete (doc/lint/pattern/list, escalation tracking) | 5+ |
| `ralph ref` | ✅ Complete (add/update/list/discover, -llms.md/.txt) | 4+ |
| `ralph hooks` | ✅ Complete (pre-commit on staged files) | 4+ |
| `ralph ci` | ✅ Complete (GitHub Actions + GitLab CI, caching) | 5+ |
| `config validate` | ✅ Complete (all sections, nested keys, type checks) | 27+ |
| `ralph run` | ✅ Complete (plan/build modes, agent abstraction, checkpoint, auto-detect) | 80+ |
| `ralph review` | ✅ Complete (diff extraction, context assembly, prompt, output formats) | 42+ |
| `ralph heal` | ✅ Complete (diagnostics, heal prompt, agent repair flow, verification) | 47+ |
| `ralph score` | ✅ Complete (script discovery, default scorer, results log, trend, CLI) | 30+ |

## Deferred Items

- **Lint --fix for structural rules** — Autofix infrastructure in place (naming-convention + custom YAML `autofix.replace`). File-size, dependency-direction, domain-isolation, file-organization report only — auto-fix not feasible without human judgment.

## Notes

- **LLM-agnostic**: Zero references to specific AI providers or models anywhere. Hard constraint.
- **ESM only**: `import` statements, never `require()`. `.ts` imports resolve to `.js` in output.
- **`exactOptionalPropertyTypes`**: Optional props need `| undefined`.
- **YAML 1.2**: Single-quote regex patterns with backslashes in `.yml` files.
- **Test isolation**: Tests `chdir()` to temp dirs with `.git/` stubs. Restore `origCwd` in `afterEach`.

---

## v0.4.1 — Pre-v0.5.0 Baseline Cleanup

**Goal:** Resolve the three non-blocking quality issues discovered at the v0.4.0 baseline before beginning fitness-scoring work.

### Task 1: Create `docs/exec-plans/active/` and `docs/exec-plans/completed/` subdirectories

- [x] Create `docs/exec-plans/active/.gitkeep` and `docs/exec-plans/completed/.gitkeep` so doctor's exec-plans structure check passes (currently 28/29 checks; this brings it to 29/29).
  Files: two new `.gitkeep` files.

### Task 2: Fix coverage attribution for `review` and `heal` domains

- [x] Configure vitest coverage to force-include `src/commands/review/**` and `src/commands/heal/**` in the coverage report so `ralph grade` can score those domains above C.
  Add `include` patterns to `vitest.config.ts` coverage settings. After running `npm run test:coverage`, both domains should appear in `coverage/lcov.info`. Verify `ralph grade` upgrades `review` and `heal` from C to B or A.
  Files: `vitest.config.ts`.

### Dependency Graph

```
Task 1 and Task 2 are independent — can run in either order.
```

### Validation

```
npm test && npx tsc --noEmit && ralph doctor --ci && ralph grade --ci
```
Expected: 685 tests pass, typecheck clean, doctor 10/10 (29/29 checks), review + heal grade B or above.

---

## v0.2.0 — `ralph run` (Autonomous Build Loop)

**Spec:** `docs/product-specs/ralph-run.md`
**Goal:** One command to spawn a configurable coding agent, generate prompts, commit per iteration, and loop until done.

### Task 1: Types + Config Schema

Add `RunConfig` and supporting types to the config system. Add defaults.

- [x] Add to `src/config/schema.ts`: `AgentConfig`, `PromptsConfig`, `LoopConfig`, `ValidationConfig`, `GitConfig`, `RunConfig` interfaces. Add `run?: RunConfig | undefined` to `RalphConfig`. Add corresponding partial types to `RawRalphConfig`.
- [x] Add to `src/config/defaults.ts`: `DEFAULT_AGENT`, `DEFAULT_RUN` with all default values from the spec's Defaults Table.
- [x] Add to `src/config/loader.ts`: merge `run.*` fields with defaults in `mergeWithDefaults()`. Handle the nested `agent`, `plan-agent`, `build-agent`, `prompts`, `loop`, `validation`, `git` sub-objects.
- [x] Files: `src/config/schema.ts`, `src/config/defaults.ts`, `src/config/loader.ts`
- [x] Tests: Unit tests in existing `tests/config.test.ts` — verify RunConfig types are populated with defaults when `run` is absent, partially specified, and fully specified. Verify `plan-agent`/`build-agent` null handling.
- [x] Done when: `loadConfig()` returns a `RalphConfig` with a fully-populated `run` field, and all existing tests still pass.

### Task 2: Run Types (`types.ts`)

Re-export types needed by other run modules and define the `AgentResult` interface.

- [x] Create `src/commands/run/types.ts`
- [x] Re-export `RunConfig`, `AgentConfig` etc. from `src/config/schema.ts` for convenience
- [x] Define `AgentResult` interface: `{ exitCode: number, durationMs: number, error?: string | undefined }`
- [x] Define `RunMode = 'plan' | 'build'`
- [x] Define `RunOptions` interface for CLI options: `{ max?: number, agent?: string, model?: string, dryRun?: boolean, noCommit?: boolean, noPush?: boolean, resume?: boolean, verbose?: boolean }`
- [x] Files: `src/commands/run/types.ts`
- [x] Tests: No dedicated tests (type-only file). Verified by TypeScript compilation and consumers in later tasks.
- [x] Done when: All run-related types are defined. `npx tsc --noEmit` passes.

### Task 3: Config Validation for `run.*`

Add validation for all `run.*` fields to the validator.

- [x] Add `'run'` to `KNOWN_TOP_KEYS` in `src/config/validate.ts`
- [x] Validate: `run.agent.cli` (non-empty string), `run.agent.args` (string array), `run.agent.timeout` (positive integer), `run.plan-agent`/`run.build-agent` (null or valid AgentConfig), `run.loop.max-iterations` (non-negative integer), `run.loop.stall-threshold` (non-negative integer), `run.git.commit-prefix` (non-empty string), `run.git.auto-commit`/`auto-push` (boolean), `run.prompts.plan`/`build` (null or string)
- [x] Warn on unknown keys within `run.*` sub-objects
- [x] Files: `src/config/validate.ts`
- [x] Tests: Add validation tests in `tests/config.test.ts` — valid run config passes, invalid `agent.cli` (empty/missing), invalid `agent.timeout` (negative/zero), invalid `loop.max-iterations` (negative), unknown keys produce warnings, `plan-agent` with invalid shape errors.
- [x] Done when: `ralph config validate` validates all `run.*` fields per spec. All existing validation tests still pass.

### Task 4: Auto-Detection (`detect.ts`)

Detect test commands, typecheck commands, and source paths from the project.

- [x] Create `src/commands/run/detect.ts`
- [x] `detectTestCommand(config: RalphConfig): string | null` — check config override first, then `package.json` scripts.test → `npm test`, `Makefile` test target → `make test`, `pyproject.toml` → `pytest`, `go.mod` → `go test ./...`, `Cargo.toml` → `cargo test`
- [x] `detectTypecheckCommand(config: RalphConfig): string | null` — config override, then `tsconfig.json` → `npx tsc --noEmit`, `mypy.ini`/`pyproject.toml[tool.mypy]` → `mypy .`, `go.mod` → `go vet ./...`
- [x] `detectSourcePath(config: RalphConfig): string` — union of `config.architecture.domains` paths, or conventional `src/` → `app/` → `lib/` → `.`
- [x] `composeValidateCommand(testCmd: string | null, typecheckCmd: string | null): string` — join non-null components + `ralph doctor --ci` + `ralph grade --ci` with ` && `
- [x] Files: `src/commands/run/detect.ts`
- [x] Tests: `tests/run-detect.test.ts` — test each detection path (TS project with package.json, Python with pyproject.toml, Go with go.mod, Rust with Cargo.toml, Makefile). Test config override takes precedence. Test source path from domains vs conventional. Test `composeValidateCommand` composition with all/some/none detected.
- [x] Done when: All 6 detection paths work. `composeValidateCommand` always includes `ralph doctor --ci && ralph grade --ci`.

### Task 5: Task Detection (`detect.ts` addition)

Detect completed tasks from IMPLEMENTATION_PLAN.md diffs for commit messages.

- [x] Add to `src/commands/run/detect.ts`: `detectCompletedTask(planBefore: string): string | null`
- [x] Read current `IMPLEMENTATION_PLAN.md`, diff line-by-line against `planBefore`
- [x] Find first line where `[ ]` became `[x]` (case-insensitive) OR line gained a `✅` prefix/suffix
- [x] Strip checkbox/emoji, trim whitespace, return task description
- [x] Add `normalizePlanContent(content: string): string` — trim trailing whitespace per line, normalize `\r\n` → `\n` (used by loop for plan-mode completion check)
- [x] Files: `src/commands/run/detect.ts`
- [x] Tests: Add to `tests/run-detect.test.ts` — checkbox `[ ]` → `[x]` detected, `✅` detection, no match returns null, whitespace-only changes return null, multiple completions returns first, `normalizePlanContent` normalizes line endings and trailing whitespace.
- [x] Done when: `detectCompletedTask` reliably finds the first newly-completed task. `normalizePlanContent` normalizes content for comparison.

### Task 6: Prompt Engine (`prompts.ts`)

Template variable substitution and built-in plan/build templates.

- [x] Create `src/commands/run/prompts.ts`
- [x] Define `PLAN_TEMPLATE` and `BUILD_TEMPLATE` as string constants (based on Huntley methodology — include `{validate_command}`, `{test_command}`, `{project_name}`, `{src_path}`, `{specs_path}`, `{date}`, `{skip_tasks}`, `{language}`, `{framework}`, `{typecheck_command}`)
- [x] `generatePrompt(mode: 'plan' | 'build', config: RalphConfig, options: { skipTasks?: string }): string` — select template (built-in or custom file path from `config.run.prompts`), fill all `{variables}`, use auto-detection for unfilled validation fields
- [x] Load custom templates from file paths when `config.run.prompts.plan`/`.build` is set
- [x] Missing variables in custom templates → leave placeholder as-is (no error)
- [x] Files: `src/commands/run/prompts.ts`
- [x] Tests: `tests/run-prompts.test.ts` — built-in template variable substitution (all variables filled), custom template from file, `{validate_command}` composed correctly, missing optional variables handled, plan vs build template selection, unknown variables in custom templates left as-is.
- [x] Done when: `generatePrompt('build', config)` returns a fully-substituted prompt string. Custom file templates work with same substitution.

### Task 7: Agent Abstraction (`agent.ts`)

Spawn agent in print mode, handle timeout, return result.

- [x] Create `src/commands/run/agent.ts`
- [x] `spawnAgent(config: AgentConfig, prompt: string, options?: { verbose?: boolean }): Promise<AgentResult>` — use `child_process.spawn`, pipe prompt to stdin, stream stdout/stderr if verbose, timeout via `AbortController`, return `{ exitCode, durationMs, error? }`
- [x] Handle spawn failures: ENOENT → `{ exitCode: 1, durationMs: 0, error: "Agent CLI \"x\" not found..." }`, EACCES/ENOMEM/broken pipe similarly
- [x] `resolveAgent(mode: 'plan' | 'build', runConfig: RunConfig, cliAgent?: string, cliModel?: string): AgentConfig` — implement 4-tier resolution: CLI flag > phase-specific > default > preset
- [x] `AGENT_PRESETS` — preset args for known CLIs (no provider names in code — use generic CLI names only)
- [x] `injectModel(args: string[], model: string): string[]` — scan for `--model`, replace value or append
- [x] Files: `src/commands/run/agent.ts`
- [x] Tests: `tests/run-agent.test.ts` — mock `child_process.spawn`. Test: successful spawn returns exit code + duration, timeout kills process and returns error, ENOENT returns error result, stdin piping sends prompt, verbose streams output. Test `resolveAgent` across all 4 tiers (CLI flag, phase-specific, default, preset). Test `injectModel` scan/replace/append/`=` form. Test preset args FULL REPLACE (not merge) when config sets args.
- [x] Done when: `spawnAgent` spawns a process, pipes prompt, handles timeout/errors. `resolveAgent` implements spec's 4-tier resolution with worked examples passing.

### Task 8: Checkpoint / Progress Tracking (`progress.ts`)

Iteration tracking, checkpoint persistence, display formatting.

- [x] Create `src/commands/run/progress.ts`
- [x] `Checkpoint` interface: `{ version: 1, phase: 'plan' | 'build', startedAt: string, iteration: number, history: IterationRecord[] }`
- [x] `IterationRecord`: `{ iteration: number, durationMs: number, exitCode: number, commit: string | null, error?: string | null }`
- [x] `loadCheckpoint(): Checkpoint | null` — read `.ralph/run-checkpoint.json`, handle version mismatch (unknown version → delete + warn + return null)
- [x] `saveCheckpoint(checkpoint: Checkpoint): void` — write to `.ralph/run-checkpoint.json`
- [x] `deleteCheckpoint(): void`
- [x] `printBanner(mode, agentConfig, runConfig): void` — formatted banner per spec
- [x] `printIterationHeader(iteration: number): void`
- [x] `printIterationSummary(iteration, result, commitHash, task): void`
- [x] `printFinalSummary(reason: string, checkpoint: Checkpoint): void` — total iterations, duration, commit range, stop reason
- [x] `formatDuration(ms: number): string` — human-readable (e.g., "4m 23s")
- [x] Files: `src/commands/run/progress.ts`
- [x] Tests: `tests/run-progress.test.ts` — checkpoint save/load round-trip, version mismatch deletes and warns, banner formatting, iteration summary formatting, final summary formatting, `formatDuration` edge cases (seconds only, minutes+seconds, hours).
- [x] Done when: Checkpoint persists to `.ralph/run-checkpoint.json` and round-trips. All display functions produce output matching spec format.

### Task 9: The Loop (`index.ts`)

The main command entry point — orchestrates everything.

- [x] Create `src/commands/run/index.ts`
- [x] `runCommand(mode: RunMode, options: RunOptions): Promise<void>` — the full loop per spec pseudocode
- [x] Load config, resolve agent, load/create checkpoint
- [x] Plan mode: check specs exist (error if none), check existing plan (confirm regenerate)
- [x] Build mode: check plan exists (prompt to run plan first, skip in non-TTY)
- [x] Dirty working tree: warn + prompt (continue in non-TTY, skip with `--no-commit`)
- [x] `--dry-run`: generate prompt, print it, exit
- [x] Signal handling: SIGINT/SIGTERM → kill agent, save checkpoint, print summary, exit. Double SIGINT within 2s → force kill, exit 1
- [x] Main loop: generate prompt → spawn agent → detect task → commit (if auto-commit + changes) → update checkpoint → check stall → check plan-mode completion → repeat
- [x] Stall detection: N consecutive no-change iterations → prompt to continue (TTY) or halt (non-TTY)
- [x] Git operations: `git add -A && git commit -m "..."`, optional `git push`
- [x] Commit message: `"{prefix} {task}"` or `"{prefix} iteration {n}"` or `"{prefix} plan iteration {n}"`
- [x] Files: `src/commands/run/index.ts`
- [x] Tests: `tests/run.test.ts` — mock agent (script that modifies files predictably). Test: single iteration lifecycle, max iterations stops loop, stall detection halts, plan mode halts when plan unchanged, `--dry-run` prints prompt without executing, `--no-commit` skips git, `--resume` continues from checkpoint, signal handling saves checkpoint. These are integration-style tests using mocked child_process and fs.
- [x] Done when: `runCommand('build', {})` executes the full loop lifecycle. All edge cases from spec handled.

### Task 10: CLI Registration

Wire `ralph run` into the commander CLI.

- [x] Add `import { runCommand } from './commands/run/index.js'` to `src/cli.ts`
- [x] Register `ralph run [mode]` with all options: `--max <n>`, `--agent <cli>`, `--model <model>`, `--dry-run`, `--no-commit`, `--no-push`, `--resume`, `--verbose`
- [x] Default mode: `'build'`. Validate mode is `'plan'` or `'build'`.
- [x] Files: `src/cli.ts`
- [x] Tests: Verify CLI parses all options correctly (can test via commander's parse with mock argv). Verify `ralph run --help` shows correct usage.
- [x] Done when: `ralph run`, `ralph run plan`, `ralph run --dry-run`, and all option combinations parse correctly and invoke `runCommand`.

### Task 11: Built-in Prompt Templates (Content)

Write the actual plan and build prompt template content.

- [x] Refine `PLAN_TEMPLATE` and `BUILD_TEMPLATE` in `src/commands/run/prompts.ts`
- [x] Plan template: instruct agent to read specs, produce/update IMPLEMENTATION_PLAN.md, use task sizing rules, include `{validate_command}` instructions
- [x] Build template: instruct agent to read IMPLEMENTATION_PLAN.md, pick next unchecked task, implement it, run `{validate_command}`, commit guidance, mark task complete
- [x] Both templates must be LLM-agnostic (no provider-specific instructions)
- [x] Include all template variables from spec: `{project_path}`, `{project_name}`, `{src_path}`, `{specs_path}`, `{date}`, `{test_command}`, `{typecheck_command}`, `{validate_command}`, `{skip_tasks}`, `{language}`, `{framework}`
- [x] Files: `src/commands/run/prompts.ts`
- [x] Tests: Update `tests/run-prompts.test.ts` — verify templates contain all required variables, verify substitution produces valid prompt text, verify no provider-specific language in templates.
- [x] Done when: Templates produce actionable prompts equivalent to the current `PROMPT_plan.md` / `PROMPT_build.md` approach. All variables substituted.

### Task 12: Integration Tests (Full Lifecycle)

End-to-end tests with a mock agent script covering the full loop.

- [x] Create mock agent script: reads stdin, writes predictable files, exits with configurable code. Support modes: normal (modify files), no-change (exit without modifying), timeout (sleep forever), fail (exit 1), plan-complete (modify IMPLEMENTATION_PLAN.md then stop modifying)
- [x] Test: Full build cycle — 3 iterations with mock agent, verify 3 commits created, checkpoint updated, summary printed
- [x] Test: Plan mode completion — mock agent modifies plan on iteration 1, doesn't modify on iteration 2 → loop halts
- [x] Test: Agent timeout — mock agent sleeps, verify timeout fires, iteration recorded with error, loop continues
- [x] Test: `--resume` — run 2 iterations, stop, resume, verify iteration count continues
- [x] Test: `--resume` phase mismatch — checkpoint from plan, run build with --resume, verify error/warning
- [x] Test: Stall detection — mock agent makes no changes for 3 iterations → loop halts (non-TTY)
- [x] Test: Custom prompt template — file-based template with variables, verify substitution in mock agent's stdin
- [x] Test: Multi-agent resolution — configure plan-agent vs build-agent, verify correct agent spawned per mode
- [x] Test: `--dry-run` — verify prompt printed to stdout, no agent spawned
- [x] Test: Signal handling — send SIGINT during iteration, verify checkpoint saved
- [x] Files: `tests/run-integration.test.ts`, `tests/fixtures/mock-agent.js` (or inline)
- [x] Tests: All scenarios above
- [x] Done when: All 10 integration scenarios pass. Branch coverage ≥80% across all `src/commands/run/*.ts` files.

### Task 13: ARCHITECTURE.md + AGENTS.md Updates

Update project documentation to reflect the new `run` domain.

- [x] Add `run` domain to ARCHITECTURE.md domain table: `run | src/commands/run | Autonomous build loop (agent spawn, prompts, progress)`
- [x] Update AGENTS.md command list to include `ralph run` with usage examples
- [x] Update IMPLEMENTATION_PLAN.md command status table to include `ralph run`
- [x] Files: `ARCHITECTURE.md`, `AGENTS.md`, `IMPLEMENTATION_PLAN.md`
- [x] Tests: No code tests. Verify `ralph doctor` still passes (it checks for ARCHITECTURE.md consistency).
- [x] Done when: All three docs updated. `ralph doctor` passes.

### Dependency Graph

```
Task 1 (schema/defaults/loader)
  └→ Task 2 (types.ts)
  └→ Task 3 (validation)
       └→ Task 4 (detect — auto-detection)
       └→ Task 5 (detect — task detection)
       └→ Task 6 (prompts)
       └→ Task 7 (agent)
       └→ Task 8 (progress)
            └→ Task 9 (loop — index.ts)
                 └→ Task 10 (CLI registration)
                 └→ Task 11 (prompt content)
                 └→ Task 12 (integration tests)
                      └→ Task 13 (docs)
```

Tasks 1 → 2 → 3 are sequential (each builds on the previous). Tasks 4–8 are independent of each other and can be parallelized once tasks 1–2 are done. Tasks 10 and 11 can be parallelized. Task 13 is last to capture final state.

---

## v0.2.1 — Dogfood Cleanup

**Spec:** `docs/product-specs/dogfood-v0.2.1.md`
**Goal:** Make ralph-cli pass its own quality bar — every domain graded B or above, zero persistent GC drift.

**Baseline:** 503 tests passing. Doctor 10/10. Grade: 11/12 domains fail docs (F). GC: 5 persistent drift items.

**Domain docs scoring:** `ralph grade` checks 3 files per domain — `{domain.path}/DESIGN.md`, `docs/design-docs/{domain.name}.md`, `docs/design-docs/{domain.name}/DESIGN.md`. All 3 must exist (3/3 = 100% = A). Each file should be 30–100 lines with sections: Purpose, Usage, Config, Architecture, Design Decisions.

### Task 1: Add `run` to config domains + docs for `config` and `run`

- [x] Add `run` domain (`path: src/commands/run`) to `.ralph/config.yml` `architecture.domains` list so `ralph grade` scores it.
- [x] Create `src/config/DESIGN.md`, `docs/design-docs/config.md`, `docs/design-docs/config/DESIGN.md` covering config loader, schema, validation, defaults.
- [x] Create `src/commands/run/DESIGN.md`, `docs/design-docs/run.md`, `docs/design-docs/run/DESIGN.md` covering the autonomous build loop, agent abstraction, prompt engine, checkpoint.
- [x] Files: `.ralph/config.yml`, 6 new doc files.
- [x] Done when: `ralph grade` shows A for `config` and `run` docs dimension.

### Task 2: Domain docs for `init` and `lint`

- [x] Create `src/commands/init/DESIGN.md`, `docs/design-docs/init.md`, `docs/design-docs/init/DESIGN.md` covering project scaffolding, language detection, template generation.
- [x] Create `src/commands/lint/DESIGN.md`, `docs/design-docs/lint.md`, `docs/design-docs/lint/DESIGN.md` covering lint engine, built-in rules (5), custom YAML/JS rules, `--fix` autofix.
- [x] Files: 6 new doc files.
- [x] Done when: `ralph grade` shows A for `init` and `lint` docs dimension.

### Task 3: Domain docs for `grade` and `gc`

- [x] Create `src/commands/grade/DESIGN.md`, `docs/design-docs/grade.md`, `docs/design-docs/grade/DESIGN.md` covering 5 scoring dimensions, per-domain scoring, trend tracking.
- [x] Create `src/commands/gc/DESIGN.md`, `docs/design-docs/gc.md`, `docs/design-docs/gc/DESIGN.md` covering 4 drift categories (principles, dead code, stale docs, patterns), history tracking, custom anti-patterns.
- [x] Files: 6 new doc files.
- [x] Done when: `ralph grade` shows A for `grade` and `gc` docs dimension.

### Task 4: Domain docs for `doctor` and `plan`

- [x] Create `src/commands/doctor/DESIGN.md`, `docs/design-docs/doctor.md`, `docs/design-docs/doctor/DESIGN.md` covering 4 check categories (structure, content, backpressure, operational), scoring, `--fix`.
- [x] Create `src/commands/plan/DESIGN.md`, `docs/design-docs/plan.md`, `docs/design-docs/plan/DESIGN.md` covering execution plan lifecycle (create/complete/abandon/list/status), decision logging, tech-debt tracking.
- [x] Files: 6 new doc files.
- [x] Done when: `ralph grade` shows A for `doctor` and `plan` docs dimension.

### Task 5: Domain docs for `promote`, `ref`, `hooks`, and `ci`

- [x] Create `src/commands/promote/DESIGN.md`, `docs/design-docs/promote.md`, `docs/design-docs/promote/DESIGN.md` covering the escalation ladder (review → docs → lint → code patterns).
- [x] Create `src/commands/ref/DESIGN.md`, `docs/design-docs/ref.md`, `docs/design-docs/ref/DESIGN.md` covering LLM-friendly external doc management, `llms.txt` discovery.
- [x] Create `src/commands/hooks/DESIGN.md`, `docs/design-docs/hooks.md`, `docs/design-docs/hooks/DESIGN.md` covering git hook installation (pre-commit, post-commit, pre-push).
- [x] Create `src/commands/ci/DESIGN.md`, `docs/design-docs/ci.md`, `docs/design-docs/ci/DESIGN.md` covering CI template generation (GitHub Actions, GitLab CI).
- [x] Files: 12 new doc files.
- [x] Done when: `ralph grade` shows A for `promote`, `ref`, `hooks`, `ci` docs dimension.

### Task 6: GC false positives — comments and exclusions

Resolves spec items 2a, 2b, 2c.

- [x] `src/config/loader.ts` lines 78–79: Add inline comment explaining that optional chaining is safe here because `validate()` is called before `mergeWithDefaults()`. Example: `// validated upstream — optional chaining is defensive, not necessary`
- [x] `src/utils/output.ts`: Add a comment block at the top explaining that `console.log` calls here are intentional — this is the structured output boundary layer. Example: `// output.ts is the logging boundary; direct console.log usage here is by design`
- [x] `.ralph/config.yml` `gc.exclude`: Add `vitest.config.ts` (config file loaded by vitest directly, never imported). This removes the "dead code" false positive.
- [x] Files: `src/config/loader.ts`, `src/utils/output.ts`, `.ralph/config.yml`.
- [x] Done when: `ralph gc` no longer reports items 2a, 2b, 2c.

### Task 7: GC null-checking migration

Resolves spec items 2d, 2e.

- [x] Identify all files using explicit `=== null` or `!== null` checks (reported by `ralph gc`).
- [x] For each occurrence, determine if migration to nullish coalescing (`??`) or optional chaining (`?.`) is safe. Migrate where safe. Where null/undefined distinction matters (`exactOptionalPropertyTypes`), add a brief comment: `// null and undefined are distinct here`.
- [x] Regression test: `npm test && npx tsc --noEmit` must pass after all changes.
- [x] Files: `src/commands/config-validate.ts`, `src/commands/gc/scanners.ts`, and any other affected files identified by `ralph gc`.
- [x] Done when: `ralph gc` no longer reports pattern inconsistency for null-checking. All tests pass.

### Task 8: Version bump + CHANGELOG

- [x] Bump `package.json` version from `0.2.0` to `0.2.1`.
- [x] Add v0.2.1 section to `CHANGELOG.md` summarising: per-domain docs (12 domains), GC drift resolved (5 items), version bump.
- [x] Update `IMPLEMENTATION_PLAN.md` Current State block: version → `0.2.1`, add `0.2.1` row to Release History.
- [x] Files: `package.json`, `CHANGELOG.md`, `IMPLEMENTATION_PLAN.md`.
- [x] Done when: `ralph --version` prints `0.2.1`. CHANGELOG has a v0.2.1 entry. All validation passes.

### Dependency Graph

```
Task 1 (config + run docs)
  └→ independent of other doc tasks

Tasks 2–5 (remaining domain docs) — all independent of each other
  └→ all independent, can run in any order

Task 6 (GC false positives — comments/exclusions)
  └→ independent

Task 7 (GC null-checking migration)
  └→ independent (but run after task 6 to verify gc count drops)

Task 8 (version bump + CHANGELOG)
  └→ must be last (summarises all prior tasks)
```

### Validation

After all tasks:
```
npm test && npx tsc --noEmit && ralph doctor --ci && ralph grade --ci
```
Expected: all tests pass, doctor 10/10, every domain A on docs dimension, `ralph gc` reports 0 items.

---

## v0.2.2 — Fix `ref` Domain Grade

**Spec:** Repair pre-existing `ralph grade --ci` failure. The `ref` domain is at D (43% line coverage), below the configured minimum of C. The implementation is complete; only tests are missing.

**Baseline:** 503 tests passing. Doctor 10/10. `ralph grade --ci` exits non-zero (1 domain below C).

### Task 1: Add tests for `refListCommand`

- [x] Add tests for `refListCommand` in `src/commands/ref/ref.test.ts`.
  - Empty references directory → info message, no output entries.
  - Directory does not exist → info message, early return.
  - With one or more reference files → prints name, size, date (from metadata comment), source.
  - With `--sizes` option → prints bar chart and total.
  - Files without metadata comment → prints name and size only (no source/date).

### Task 2: Add tests for `refUpdateCommand`

- [x] Add tests for `refUpdateCommand` in `src/commands/ref/ref.test.ts`.
  - No references directory → error message, returns without crash.
  - References directory with no HTTP-sourced files → reports "No references were updated."
  - A file with an HTTP source URL → mock `fetch`, verify file content is rewritten with new content and updated `fetched=` date.
  - `name` argument provided → only the matching file is updated, others are skipped.
  - Fetch returns non-OK status → warn message, file is not modified.
  - Fetch throws → warn message, file is not modified.

### Task 3: Add tests for URL-based `refAddCommand` and error paths

- [x] Add tests in `src/commands/ref/ref.test.ts` for paths not yet covered.
  - URL argument → mock `fetch`, verify file written with correct content and metadata, name derived from hostname.
  - URL fetch returns 404 → `error()` called, `process.exit(1)` triggered.
  - URL fetch throws network error → `error()` called, `process.exit(1)` triggered.
  - Local file argument where file does not exist → `error()` called, `process.exit(1)` triggered.
  - Size warning: add a file large enough to exceed `warn-single-file-kb` → `warn()` output includes warning.

### Task 4: Add tests for `refDiscoverCommand` pyproject.toml and go.mod paths

- [x] Add tests in `src/commands/ref/ref.test.ts` for dependency discovery from non-npm lockfiles.
  - `pyproject.toml` with `[tool.poetry.dependencies]` → dependencies extracted and scanned.
  - `go.mod` with `require` block → modules extracted and scanned.
  - Both files present → deps from both are unioned.
  - Successful fetch of `llms.txt` from a discovered dependency (mock fetch) → ref appears in "Found" list.

### Dependency Graph

```
Tasks 1–4 are independent of each other and can run in any order.
All four must complete before the validation command passes.
```

### Validation

After all tasks:
```
npm test && npx tsc --noEmit && ralph doctor --ci && ralph grade --ci
```
Expected: all tests pass, doctor 10/10, `ref` domain C or above, `ralph grade --ci` exits 0.

---

## v0.3.0 — `ralph review` (Agent-Powered Code Review)

**Spec:** `docs/product-specs/ralph-review.md`
**Goal:** Feed code changes to a configurable coding agent for semantic review — architectural drift, logic errors, spec violations.

**Baseline:** v0.2.2 complete. 528 tests passing. Doctor 10/10. `ralph grade --ci` exits 0. No `src/commands/review/` directory exists.

### Task 1: Config schema + defaults for `ReviewConfig`

- [x] Add `ReviewContextConfig`, `ReviewOutputConfig`, `ReviewConfig` interfaces to `src/config/schema.ts`. Add `review?: ReviewConfig | undefined` to `RalphConfig` and corresponding partial to `RawRalphConfig`.
- [x] Add `DEFAULT_REVIEW` to `src/config/defaults.ts` with all defaults from spec's Defaults Table (`scope: 'staged'`, `context.include-specs: true`, `context.include-architecture: true`, `context.include-diff-context: 5`, `context.max-diff-lines: 2000`, `output.format: 'text'`, `output.file: null`, `output.severity-threshold: 'info'`).
- [x] Add `review` merge to `mergeWithDefaults()` in `src/config/loader.ts` (same pattern as `run`).
- [x] Files: `src/config/schema.ts`, `src/config/defaults.ts`, `src/config/loader.ts`
- [x] Tests: Add to `tests/config.test.ts` — `loadConfig()` returns fully-populated `review` field when absent, partially specified, and fully specified. Verify `review.agent` null handling.
- [x] Done when: `loadConfig()` returns a `RalphConfig` with a fully-populated `review` field. All existing tests pass.

### Task 2: Config validation for `review.*` fields

- [x] Add `'review'` to `KNOWN_TOP_KEYS` in `src/config/validate.ts`.
- [x] Validate: `review.agent` (null or valid AgentConfig), `review.scope` (one of staged/commit/range/working), `review.context.include-diff-context` (non-negative integer), `review.context.max-diff-lines` (positive integer), `review.output.format` (one of text/json/markdown), `review.output.file` (null or string), `review.output.severity-threshold` (one of info/warn/error).
- [x] Warn on unknown keys within `review.*` sub-objects.
- [x] Files: `src/config/validate.ts`
- [x] Tests: Add to `tests/config.test.ts` — valid review config passes, invalid `review.scope` errors, invalid `review.output.format` errors, unknown keys produce warnings.
- [x] Done when: `ralph config validate` validates all `review.*` fields per spec.

### Task 3: Review types (`types.ts`)

- [x] Create `src/commands/review/types.ts`.
- [x] Re-export `ReviewConfig`, `ReviewContextConfig`, `ReviewOutputConfig` from `src/config/schema.ts`.
- [x] Define `ReviewOptions` interface: `{ scope?: string, agent?: string, model?: string, format?: string, output?: string, dryRun?: boolean, verbose?: boolean, diffOnly?: boolean }`.
- [x] Define `ReviewContext` interface: `{ diff: string, diffStat: string, changedFiles: string[], architecture: string, specs: string[], rules: string, projectName: string, scope: string, durationMs?: number }`.
- [x] Files: `src/commands/review/types.ts`
- [x] Tests: None (type-only). Verified by TypeScript compilation.
- [x] Done when: `npx tsc --noEmit` passes with new types.

### Task 4: Diff extraction + context assembly (`context.ts`)

- [x] Create `src/commands/review/context.ts`.
- [x] `resolveScope(target: string | undefined, scopeFlag: string | undefined, configScope: string): { gitArgs: string[], scopeLabel: string }` — implement all 6 scope cases from the spec table. Error on `--scope range` with no target.
- [x] `extractDiff(gitArgs: string[], contextLines: number): { diff: string, diffStat: string, changedFiles: string[], binaryCount: number }` — run `git diff --unified={n}` and `git diff --stat`, parse changed files from stat output, skip binary files.
- [x] `findRelevantSpecs(changedFiles: string[], specsDir: string): string[]` — extract directory names from changed files, fuzzy-match against spec filenames (up to 3 results).
- [x] `assembleContext(config: RalphConfig, diff: string, diffStat: string, changedFiles: string[], options: { diffOnly: boolean, maxDiffLines: number }): ReviewContext` — load ARCHITECTURE.md, matched specs, AGENTS.md rules section, truncate diff at maxDiffLines with warning.
- [x] Files: `src/commands/review/context.ts`
- [x] Tests: `tests/review-context.test.ts` — all 6 scope resolution cases, spec matching (exact, fuzzy, no match), diff truncation at maxDiffLines with warning emitted, binary file count, empty diff detection, not-a-git-repo error.
- [x] Done when: All scope resolution + context assembly cases pass tests.

### Task 5: Review prompt template (`prompts.ts`)

- [x] Create `src/commands/review/prompts.ts`.
- [x] Define `REVIEW_TEMPLATE` string constant matching the spec's prompt template exactly (all 6 sections: project context, architecture, specs, rules, diff stat, diff, review instructions).
- [x] `generateReviewPrompt(context: ReviewContext, options: { diffOnly: boolean }): string` — substitute all template variables: `{project_name}`, `{architecture_content}`, `{specs_content}`, `{rules_content}`, `{diff_stat}`, `{diff_content}`. When `diffOnly`, omit architecture/specs/rules sections.
- [x] Files: `src/commands/review/prompts.ts`
- [x] Tests: `tests/review-prompts.test.ts` — all variables substituted, `--diff-only` excludes context sections, template matches spec structure.
- [x] Done when: `generateReviewPrompt()` produces a complete prompt with all variables filled.

### Task 6: Command entry point (`index.ts`)

- [x] Create `src/commands/review/index.ts`.
- [x] `reviewCommand(target: string | undefined, options: ReviewOptions): Promise<void>` — orchestrates: load config → resolve scope → extract diff → handle edge cases (no diff, not git repo, empty diff) → assemble context → generate prompt → `--dry-run` path (print prompt, exit) → resolve agent (reuse `resolveAgent` from `../run/agent.js` with `review.agent` falling back to `run.agent`) → spawn agent → format output (text/markdown/JSON) → write to file or stdout.
- [x] Edge cases: no staged changes, not a git repo, agent not installed, `--scope range` with no target.
- [x] Output formatting: text (pass through), markdown (add header with date/scope/files), JSON (`{ project, date, scope, files, review, model, durationMs }`).
- [x] Files: `src/commands/review/index.ts`
- [x] Tests: `tests/review.test.ts` — mock `spawnAgent` and git commands. Test: staged review default flow, commit SHA review, range review, `--dry-run` prints prompt without agent, `--format json` produces JSON structure, `--format markdown` adds header, `--diff-only` excludes context, no changes error, large diff truncation warning.
- [x] Done when: All review scenarios pass. `ralph review --dry-run` works end-to-end.

### Task 7: CLI registration

- [x] Add `import { reviewCommand } from './commands/review/index.js'` to `src/cli.ts`.
- [x] Register `ralph review [target]` with all options: `--scope <scope>`, `--agent <cli>`, `--model <model>`, `--format <fmt>`, `--output <path>`, `--dry-run`, `--verbose`, `--diff-only`.
- [x] Files: `src/cli.ts`
- [x] Tests: Verify `ralph review --help` shows correct usage. Verify option parsing via commander parse.
- [x] Done when: `ralph review`, `ralph review HEAD`, `ralph review --dry-run` all parse correctly and invoke `reviewCommand`.

### Task 8: ARCHITECTURE.md update

- [x] Add `review` domain row to ARCHITECTURE.md domain table: `review | src/commands/review | Agent-powered code review (diff extraction, context assembly, prompt)`.
- [x] Document cross-command import exception: `review/index.ts` imports from `run/agent.ts` (documented exception, same as doctor→init pattern).
- [x] Files: `ARCHITECTURE.md`
- [x] Tests: Verify `ralph doctor` still passes (checks ARCHITECTURE.md consistency).
- [x] Done when: ARCHITECTURE.md updated. `ralph doctor` passes.

### Task 9: Domain docs for `review`

- [x] Create `src/commands/review/DESIGN.md`, `docs/design-docs/review.md`, `docs/design-docs/review/DESIGN.md` covering diff extraction, context assembly, prompt generation, output formats, and agent reuse from `run`.
- [x] Each file 30–100 lines with sections: Purpose, Usage, Config, Architecture, Design Decisions.
- [x] Files: 3 new doc files.
- [x] Done when: `ralph grade` shows A for `review` docs dimension.

### Dependency Graph

```
Task 1 (config schema + defaults)
  └→ Task 2 (config validation)
  └→ Task 3 (types.ts)
       └→ Task 4 (context.ts)
       └→ Task 5 (prompts.ts)
            └→ Task 6 (index.ts — uses context + prompts + agent)
                 └→ Task 7 (CLI registration)
                 └→ Task 8 (ARCHITECTURE.md)
                 └→ Task 9 (domain docs)
```

Tasks 1 → 3 sequential. Tasks 4 and 5 parallel once 3 is done. Task 6 needs 4+5. Tasks 7, 8, and 9 parallel once 6 is done.

### Validation

After all tasks:
```
npm test && npx tsc --noEmit && ralph doctor --ci && ralph grade --ci
```
Expected: all tests pass, doctor 10/10, `ralph review` command functional, all acceptance criteria from spec satisfied.

---

## v0.4.0 — `ralph heal` (Automated Self-Repair)

**Spec:** `docs/product-specs/ralph-heal.md`
**Goal:** Run ralph's own diagnostics, feed failures to a coding agent, commit the fixes — automated self-repair.

**Baseline:** v0.3.0 complete. 627 tests passing. Doctor 10/10. `ralph grade --ci` exits 0. No `src/commands/heal/` directory exists.

### Task 1: Config schema + defaults for `HealConfig`

Add `HealConfig` and supporting types to the config system.

- [x] Add `HealConfig` interface to `src/config/schema.ts`: `{ agent: AgentConfig | null, commands: string[], 'auto-commit': boolean, 'commit-prefix': string }`. Add `heal?: HealConfig | undefined` to `RalphConfig` and corresponding partial to `RawRalphConfig`.
- [x] Add `DEFAULT_HEAL` to `src/config/defaults.ts` with defaults: `agent: null`, `commands: ['doctor', 'grade', 'gc', 'lint']`, `auto-commit: true`, `commit-prefix: 'ralph: heal'`.
- [x] Add `heal` merge to `mergeWithDefaults()` in `src/config/loader.ts` (same pattern as `run` and `review`).
- [x] Files: `src/config/schema.ts`, `src/config/defaults.ts`, `src/config/loader.ts`
- [x] Tests: Add to `tests/config.test.ts` — `loadConfig()` returns fully-populated `heal` field when absent, partially specified, and fully specified. Verify `heal.agent` null handling.
- [x] Done when: `loadConfig()` returns a `RalphConfig` with a fully-populated `heal` field. All existing tests pass.

### Task 2: Config validation for `heal.*` fields

Add validation for all `heal.*` fields to the validator.

- [x] Add `'heal'` to `KNOWN_TOP_KEYS` in `src/config/validate.ts`.
- [x] Validate: `heal.agent` (null or valid AgentConfig), `heal.commands` (array of strings, each one of `doctor`/`grade`/`gc`/`lint`), `heal.auto-commit` (boolean), `heal.commit-prefix` (non-empty string).
- [x] Warn on unknown keys within `heal.*` sub-objects.
- [x] Files: `src/config/validate.ts`
- [x] Tests: Add to `tests/config.test.ts` — valid heal config passes, invalid `heal.commands` entry errors, invalid `heal.auto-commit` type errors, unknown keys produce warnings.
- [x] Done when: `ralph config validate` validates all `heal.*` fields per spec.

### Task 3: Heal types (`types.ts`)

Define types used by all heal modules.

- [x] Create `src/commands/heal/types.ts`.
- [x] Re-export `HealConfig` from `src/config/schema.ts`.
- [x] Define `HealOptions`: `{ agent?: string | undefined, model?: string | undefined, only?: string | undefined, skip?: string | undefined, dryRun?: boolean | undefined, noCommit?: boolean | undefined, verbose?: boolean | undefined }`.
- [x] Define `DiagnosticResult`: `{ command: string, issues: number, output: string, exitCode: number }`.
- [x] Define `HealContext`: `{ diagnostics: DiagnosticResult[], totalIssues: number, projectName: string }`.
- [x] Files: `src/commands/heal/types.ts`
- [x] Tests: None (type-only). Verified by TypeScript compilation.
- [x] Done when: `npx tsc --noEmit` passes with new types.

### Task 4: Diagnostics module (`diagnostics.ts`)

Run ralph diagnostic commands and parse their output into issue counts.

- [x] Create `src/commands/heal/diagnostics.ts`.
- [x] `runCommand(cmd: string): Promise<{ output: string, exitCode: number }>` — spawn command, capture stdout+stderr, return both.
- [x] `parseDoctorOutput(output: string): number` — count lines starting with `✗` (check failures).
- [x] `parseGradeOutput(output: string): number` — count occurrences of `F` or `D` grade labels in output.
- [x] `parseGcOutput(output: string): number` — count lines starting with `⚠`.
- [x] `parseLintOutput(output: string): number` — count violation lines (lines containing "violation" or non-zero counts from summary).
- [x] `runDiagnostics(commands: string[], options: { only?: string, skip?: string }): Promise<DiagnosticResult[]>` — resolve effective command list (apply `--only` and `--skip` filtering; skip wins if both match), run each command, parse issues.
- [x] Files: `src/commands/heal/diagnostics.ts`
- [x] Tests: `tests/heal-diagnostics.test.ts` — test each parse function with realistic fixture output (doctor failure lines, grade D/F lines, gc warning lines, lint violation lines), test `runDiagnostics` with mocked `runCommand`, test `--only` filtering, `--skip` filtering, overlap (skip wins).
- [x] Done when: All parse functions accurately count issues from realistic command output. `runDiagnostics` applies filters correctly.

### Task 5: Prompt template (`prompts.ts`)

Template for the heal agent prompt.

- [x] Create `src/commands/heal/prompts.ts`.
- [x] Define `HEAL_TEMPLATE` string constant: includes project context (`{project_name}`, `{project_path}`, `{date}`), diagnostic output (`{diagnostics_output}`), validate command (`{validate_command}`), and instructions (read output carefully, make minimal changes, don't lower quality bars, don't refactor unrelated code, run failing command after each fix to verify; fix priority: doctor > lint > gc > grade).
- [x] `generateHealPrompt(context: HealContext, validateCommand: string, projectPath: string, date: string): string` — substitute all template variables.
- [x] Files: `src/commands/heal/prompts.ts`
- [x] Tests: `tests/heal-prompts.test.ts` — all variables substituted, template contains priority instructions, `{diagnostics_output}` includes per-command sections.
- [x] Done when: `generateHealPrompt()` returns a complete prompt string with all variables filled.

### Task 6: Command entry point (`index.ts`)

Orchestrate the full heal workflow.

- [x] Create `src/commands/heal/index.ts`.
- [x] `healCommand(options: HealOptions): Promise<void>` implementing the spec's 10-step command flow:
  1. Load config
  2. Run diagnostics (applying `--only`/`--skip` from options)
  3. If total issues = 0: print "All clear" and exit 0
  4. Print diagnostic summary (per-command issue count + total)
  5. If `--dry-run`: generate prompt, print to stdout, exit 0
  6. Resolve agent (CLI flag `--agent` → `config.heal.agent` → `config.run.agent` → AGENT_PRESETS) using `resolveAgent` from `../run/agent.js`
  7. Generate prompt via `generateHealPrompt` and spawn agent via `spawnAgent` from `../run/agent.js`
  8. If `config.heal.auto-commit` and not `--no-commit` and git changes exist: commit with `config.heal.commit-prefix`
  9. Re-run diagnostics
  10. If remaining issues > 0: report count; else: print "All issues resolved"
- [x] Use `detectTestCommand`, `detectTypecheckCommand`, `composeValidateCommand` from `../run/detect.js` for the `{validate_command}` in the prompt.
- [x] Edge cases: no git repo (skip commit step without error), agent not installed (error before spawn), diagnostic command fails to execute (warn and skip that command), all diagnostics pass (exit 0 after step 3).
- [x] Files: `src/commands/heal/index.ts`
- [x] Tests: `tests/heal.test.ts` — mock `spawnAgent`, `runCommand`, git operations. Test: all diagnostics pass → exits clean; doctor only has issues → agent spawned with doctor output; multiple failures → all included in prompt; `--dry-run` prints prompt without spawning; `--only doctor` limits to doctor command; `--skip grade` skips grade; `--no-commit` skips git; agent spawned with correct args; re-run diagnostics after fix; remaining issues reported.
- [x] Done when: All heal scenarios pass. `ralph heal --dry-run` works end-to-end.

### Task 7: CLI registration

Wire `ralph heal` into the commander CLI.

- [x] Add `import { healCommand } from './commands/heal/index.js'` to `src/cli.ts`.
- [x] Register `ralph heal` with all options: `--agent <cli>`, `--model <model>`, `--only <cmds>`, `--skip <cmds>`, `--dry-run`, `--no-commit`, `--verbose`.
- [x] Files: `src/cli.ts`
- [x] Tests: Verify `ralph heal --help` shows correct usage. Verify option parsing via commander parse.
- [x] Done when: `ralph heal`, `ralph heal --dry-run`, and all option combinations parse correctly and invoke `healCommand`.

### Task 8: ARCHITECTURE.md update + domain docs for `heal`

- [x] Add `heal` domain row to ARCHITECTURE.md domain table: `heal | src/commands/heal | Automated self-repair (diagnostics, prompt, agent-driven fixes)`.
- [x] Document cross-command import exceptions: `heal/index.ts` imports from `run/agent.ts` and `run/detect.ts`.
- [x] Create `src/commands/heal/DESIGN.md`, `docs/design-docs/heal.md`, `docs/design-docs/heal/DESIGN.md` — each 30–100 lines with sections: Purpose, Usage, Config, Architecture, Design Decisions (at least 2).
- [x] Add `heal` domain to `.ralph/config.yml` `architecture.domains` list so `ralph grade` scores it.
- [x] Files: `ARCHITECTURE.md`, `.ralph/config.yml`, 3 new doc files.
- [x] Tests: Verify `ralph doctor --ci` still passes. Verify `ralph grade` shows A for `heal` docs dimension.
- [x] Done when: ARCHITECTURE.md updated. `ralph doctor` passes. `ralph grade --ci` exits 0.

### Task 9: Version bump + CHANGELOG

- [x] Bump `package.json` version to `0.4.0`.
- [x] Add v0.4.0 section to `CHANGELOG.md` summarising: ralph heal command (automated self-repair via diagnostics + agent), 9 tasks, test count.
- [x] Update `IMPLEMENTATION_PLAN.md` Current State block: version → `0.4.0`, commands → 13, add `0.4.0` row to Release History, add `ralph heal` row to Command Status table.
- [x] Files: `package.json`, `CHANGELOG.md`, `IMPLEMENTATION_PLAN.md`.
- [x] Done when: `ralph --version` prints `0.4.0`. CHANGELOG has a v0.4.0 entry. All validation passes.

### Dependency Graph

```
Task 1 (schema/defaults/loader)
  └→ Task 2 (validation)
  └→ Task 3 (types.ts)
       └→ Task 4 (diagnostics.ts)
       └→ Task 5 (prompts.ts)
            └→ Task 6 (index.ts — uses diagnostics + prompts + agent)
                 └→ Task 7 (CLI registration)
                 └→ Task 8 (ARCHITECTURE.md + domain docs)
                      └→ Task 9 (version bump + CHANGELOG)
```

Tasks 1 → 3 sequential. Tasks 4 and 5 parallel once 3 is done. Task 6 needs 4+5. Tasks 7 and 8 parallel once 6 is done. Task 9 is last.

### Validation

After all tasks:
```
npm test && npx tsc --noEmit && ralph doctor --ci && ralph grade --ci
```
Expected: all tests pass, doctor 10/10, `ralph heal` command functional, all acceptance criteria from spec satisfied.

---

## v0.5.0 — `ralph score` (Fitness Scoring)

**Spec:** `docs/product-specs/fitness-scoring.md`
**Goal:** Add gradient-based fitness scoring to the run loop — score script execution, auto-revert on regression, iteration timeout, post-agent validation, and a standalone `ralph score` command.

### Task 1: Config Schema + Defaults for Scoring

- [x] Add `ScoringConfig` to schema, defaults, loader; extend `LoopConfig`, `AgentResult`, `RunOptions`, and `Checkpoint` with scoring fields.
  Add `ScoringConfig` interface (`script`, `regression-threshold`, `cumulative-threshold`, `auto-revert`, `default-weights`) and `scoring?: ScoringConfig | undefined` to `RalphConfig`/`RawRalphConfig` in `src/config/schema.ts`. Add `iteration-timeout` to `LoopConfig`. Add `timedOut: boolean` to `AgentResult` and `noScore`/`simplify`/`baselineScore`/`force` to `RunOptions` in `src/commands/run/types.ts`. Add `DEFAULT_SCORING` and update `DEFAULT_LOOP` with `iteration-timeout: 900` in `src/config/defaults.ts`. Merge scoring defaults in `mergeWithDefaults()` in `src/config/loader.ts`. Add `lastScore`, `lastScoredIteration`, `bestScore`, `consecutiveDiscards`, `baselineScore`, `baselineCommit` (all optional) to `Checkpoint` in `src/commands/run/progress.ts`. Satisfies F-FS01–F-FS11 config prerequisites (AC-52, AC-71, AC-76).

### Task 2: Config Validation for Scoring Fields

Add validation rules for all new scoring config fields.

- [x] Add scoring field validation to `src/config/validate.ts`.
  Validate: `scoring.regression-threshold` (0.0–1.0), `scoring.cumulative-threshold` (0.0–1.0), `scoring.auto-revert` (boolean), `scoring.script` (null or string), `scoring.default-weights.tests + coverage === 1.0` within 0.001 tolerance, `run.loop.iteration-timeout` (non-negative integer). Warn on unknown keys. Satisfies AC-13, AC-53.

### Task 3: Score Types (`src/commands/score/types.ts`)

Create the `score/` domain with its foundational type definitions.

- [x] Create `src/commands/score/types.ts` with `ScoreResult`, `ResultEntry`, and `ScoreContext` interfaces.
  Define `ScoreResult` (score, source, scriptPath, metrics, error), `ResultEntry` (commit, iteration, status, score, delta, durationS, metrics, description), and `ScoreContext` (previousStatus, previousScore, currentScore, delta, metrics, changedMetrics, timeoutSeconds, regressionThreshold, previousTestCount, currentTestCount). No external dependencies. Satisfies F-FS01–F-FS07 type contracts.

### Task 4: Results Log (`src/commands/score/results.ts`)

Implement `.ralph/results.tsv` append-only read/write logic.

- [x] Create `src/commands/score/results.ts` with `appendResult()` and `readResults()`.
  `appendResult(entry: ResultEntry): void` — creates header if file absent, sanitizes tab chars in values, caps metrics at 200 chars with `…`, replaces control chars. `readResults(limit?: number): ResultEntry[]` — parses TSV, returns last N rows. Satisfies F-FS03 (AC-14, AC-15, AC-16, AC-17, AC-18, AC-67).

### Task 5: Score Script Discovery + Execution (`src/commands/score/scorer.ts`)

Implement score script discovery (config → score.sh → score.ts → score.py → default) and execution.

- [x] Create `src/commands/score/scorer.ts` with `discoverScorer()` and `runScorer()`.
  `discoverScorer(config)` — short-circuit if/else chain checking config override, then `score.sh`, `score.ts` (via `npx tsx`), `score.py` (via `python3`); returns null for default. `runScorer(scriptPath, iteration, commit)` — spawns with `RALPH_ITERATION`/`RALPH_COMMIT` env vars, 60s timeout, parses `<score>\t<metrics>` stdout format, validates score 0.0–1.0, handles `EACCES` fallback. Satisfies F-FS01 (AC-01–AC-07).

### Task 6: Default Scorer (`src/commands/score/default-scorer.ts`)

Implement the built-in scorer that extracts test count + coverage from captured output/files.

- [x] Create `src/commands/score/default-scorer.ts` with `runDefaultScorer()`.
  Parse test pass/fail counts from validation stdout using the five defined regex patterns. Read coverage from JSON report at configured path (Istanbul `total.statements.pct` → `total.lines.pct` → `statements.pct` → `lines.pct`). Compute weighted score per spec formula (single-signal = full weight). Always include `test_count`, `test_total`, `test_rate`, `coverage` in metrics output. Return null score when neither signal available. Satisfies F-FS02 (AC-08–AC-12, AC-58).

### Task 7: Score Trend + Sparkline (`src/commands/score/trend.ts`)

Implement trend computation and ASCII sparkline rendering for `ralph score --trend`.

- [x] Create `src/commands/score/trend.ts` with `computeTrend()` and `renderSparkline()`.
  `renderSparkline(scores: (number | null)[])` — maps scores to 8 Unicode block chars (`▁▂▃▄▅▆▇█`); flat/equal scores use `▅`; null entries skipped. `computeTrend(entries: ResultEntry[], n: number)` — returns min, max, best iteration, worst iteration, first/last scored values. Satisfies F-FS08 `--trend` output (AC-42).

### Task 8: `ralph score` CLI Command (`src/commands/score/index.ts` + CLI registration)

Implement the standalone `ralph score` command with all subcommand flags.

- [x] Create `src/commands/score/index.ts` and register `ralph score` in `src/cli.ts`.
  Implement: bare `ralph score` (run scorer, print score + metrics with source label), `--history [N]` (last N results.tsv entries, default 20), `--trend [N]` (sparkline + best/worst summary, default 20), `--compare` (current score vs last results.tsv entry with threshold indicator), `--json` (JSON output with score, source, metrics, timestamp). Exit 0 on success, 1 on scoring failure. Set `RALPH_ITERATION="0"` for standalone. Satisfies F-FS08 (AC-40–AC-44).

### Task 9: Run Lock (`src/commands/run/lock.ts`)

Implement the run lock to prevent concurrent `ralph run` instances.

- [x] Create `src/commands/run/lock.ts` with `acquireLock()`, `releaseLock()`, `isLockHeld()`.
  Write `.ralph/run.lock` with `{ pid, startedAt }` using exclusive `wx` flag. On `EEXIST`: read PID, check liveness via `process.kill(pid, 0)`, dead = delete and retry, alive = throw with message. Register `process.on('exit', releaseLock)`. `--force` deletes lockfile without PID check before acquire. Satisfies F-FS11 (AC-54–AC-57).

### Task 10: Iteration Timeout (`src/commands/run/timeout.ts`)

Wrap `spawnAgent()` with a wall-clock timeout that sends SIGTERM then SIGKILL.

- [x] Create `src/commands/run/timeout.ts` with `spawnAgentWithTimeout()`.
  Accepts iteration timeout in seconds. If timeout > 0: start timer, send SIGTERM at expiry, wait 10s, send SIGKILL. Override `AgentConfig.timeout` to `Math.max(iterationTimeout + 30, agentConfig.timeout)` per spec to prevent inner abort racing the outer SIGTERM. Return `AgentResult` with `timedOut: true` on timeout. Timeout 0 = pass through to `spawnAgent()` unchanged. Satisfies F-FS05 (AC-26–AC-29).

### Task 11: Post-Agent Validation (`src/commands/run/validation.ts`)

Implement independent post-agent validation runner for `test-command` and `typecheck-command`.

- [x] Create `src/commands/run/validation.ts` with `runValidation()`.
  `runValidation(config)` — run `validation.test-command` then `validation.typecheck-command` (each with 120s hardcoded timeout). Capture test command stdout in memory (for default scorer). On non-zero exit: return `{ passed: false, testOutput: string }`. Both null = pass immediately. Satisfies F-FS06 (AC-31–AC-34).

### Task 12: Run Loop Scoring Integration (`src/commands/run/scoring.ts` + `run/index.ts` + `run/prompts.ts`)

Wire scoring, revert, regression detection, `.ralph/keep`, cumulative check, baseline recalibration, and score context injection into the run loop.

- [x] Create `src/commands/run/scoring.ts` and update `src/commands/run/index.ts` and `src/commands/run/prompts.ts`.
  **scoring.ts**: `buildScoreContext(ctx: ScoreContext): string` — generates score context string per the five status templates (pass/discard/timeout/fail/none); includes test count jump warning when count increased >100% (skip if previous count was 0). `computeRegression(newScore, checkpoint, config)` — returns per-iteration delta and cumulative drop vs bestScore. **run/index.ts**: insert into build-mode loop: capture baseline commit + original branch + pre-agent untracked files + `keepExistedBeforeAgent` before spawn; after agent: run `spawnAgentWithTimeout()`, detect timeout → revert + log `timeout`; check `hasChanges() || currentHead !== baseline` (skip results.tsv if no new work); run `runValidation()` → fail → revert + log `fail`; post-validation auto-commit; run scoring (skip if `--no-score`); post-scoring dirty check (compare HEAD + porcelain before/after score script); regression checks → revert + log `discard`; `.ralph/keep` handling; baseline recalibration after 3 consecutive discards; cumulative regression check; `appendResult()`; inject score context for next prompt; update checkpoint. Acquire lock at pre-loop; release post-loop. Plan mode exemption: skip all above except lock. **run/prompts.ts**: add `{score_context}` placeholder to `BUILD_TEMPLATE`; extend `generatePrompt()` and `buildVariables()` to accept and inject `scoreContext` option. Satisfies F-FS04 + F-FS07 (AC-19–AC-25, AC-35–AC-39, AC-51, AC-53, AC-58–AC-77).

### Task 13: New Run Flags (`--no-score`, `--simplify`, `--baseline-score`, `--force`)

Add new CLI flags to `ralph run` and implement their behavior.

- [x] Add `--no-score`, `--simplify`, `--baseline-score <float>`, `--force` to the `ralph run` CLI definition in `src/cli.ts` and implement flag validation + simplify prompt in `src/commands/run/index.ts`.
  Flag validation (pre-loop): `--simplify` + `--mode plan` → error; `--no-score` + `--simplify` → error; `--no-score` + `--baseline-score` → error; `--baseline-score` + `--mode plan` → error. `--simplify` replaces the `## Your Task` section and beyond in the build prompt with the simplification preamble. `--baseline-score` stored in `checkpoint.baselineScore`. `--force` passed to `acquireLock()`. Satisfies F-FS09, F-FS10 (AC-45–AC-50), AC-53, AC-68–AC-69.

### Task 14: Tests — `score/` Domain

Unit and CLI integration tests for all `score/` modules.

- [x] Create `src/commands/score/score.test.ts` and `src/commands/score/cli.test.ts` covering the score domain.
  **score.test.ts**: discoverScorer priority order + short-circuit; script execution with env vars; output parsing (score+metrics, no-tab, empty, out-of-range, non-numeric); EACCES fallback; 60s timeout kill; default scorer regex patterns for all five test count patterns; coverage JSON field priority order; single-signal weighting; null when neither signal; `test_count`/`test_total` always in metrics; results.tsv append (header creation, append, sanitization, recreation after delete); sparkline algorithm (normal, flat, null entries). **cli.test.ts**: `ralph score` (no flags, --history, --trend, --compare, --json, exit codes). Target: ≥90% coverage for `score/` domain. Satisfies AC-01–AC-18, AC-40–AC-44, AC-58.

### Task 15: Tests — Run Loop Additions

Unit tests for lock, timeout, validation, and scoring integration in the run domain.

- [x] Add tests for `run/lock.ts`, `run/timeout.ts`, `run/validation.ts`, and `run/scoring.ts` to the run test suite.
  **lock**: acquire success, EEXIST + dead PID = retry, EEXIST + live PID = throw, --force override, release idempotent. **timeout**: timeout=0 passthrough, SIGTERM at expiry, SIGKILL after 10s, timedOut field on result. **validation**: test command stdout captured, non-zero → fail, typecheck non-zero → fail, both null → pass, 120s timeout kill. **scoring**: `buildScoreContext` for all five status templates, test count jump warning, skip when prev count=0; regression checks (per-iteration, cumulative, exactly-at-threshold boundary); `.ralph/keep` honored/ignored; baseline recalibration after 3 discards; `auto-revert: false` logs regression as pass. Satisfies AC-19–AC-39, AC-54–AC-57, AC-59–AC-77.

### Task 16: Docs + Architecture Updates

Update project documentation to reflect the new `score/` domain and run loop hardening.

- [x] Update `ARCHITECTURE.md`, `AGENTS.md`, `docs/design-docs/score/` domain docs, `src/commands/score/DESIGN.md`, `.ralph/config.yml`, and `docs/RELIABILITY.md` for the fitness scoring feature.
  Add `score` as a new domain in `ARCHITECTURE.md` (layer, dependencies: score → config). Add `ralph score` to the commands list in `AGENTS.md`. Create `src/commands/score/DESIGN.md` and `docs/design-docs/score/` with the three standard domain doc files (each 30–100 lines, sections: Purpose, Usage, Config, Architecture, Design Decisions). Add `score` domain (`path: src/commands/score`) to `.ralph/config.yml` `architecture.domains` list so `ralph grade` scores it. Update `docs/RELIABILITY.md` to document the auto-revert safety net and run lock. Update `IMPLEMENTATION_PLAN.md` version table for 0.5.0 release.

### Task 17: Version Bump + CHANGELOG

- [x] Bump `package.json` version to `0.5.0`. Add v0.5.0 section to `CHANGELOG.md` summarising: `ralph score` command, fitness scoring in run loop (scoring, revert, timeout, validation, score context), run lock, 16 implementation tasks. Update `IMPLEMENTATION_PLAN.md` Current State block: version → `0.5.0`, commands → 14, add `0.5.0` row to Release History, add `ralph score` row to Command Status table.
  Files: `package.json`, `CHANGELOG.md`, `IMPLEMENTATION_PLAN.md`. Done when: `ralph --version` prints `0.5.0`. All validation passes.

### Dependency Graph

```
Tasks 1–3 sequential (schema → types)
  └→ Tasks 4–7 parallel (results, scorer, default-scorer, trend)
       └→ Task 8 (ralph score CLI — needs 4–7)
  └→ Task 9 (run lock — independent)
  └→ Task 10 (timeout — needs Task 1 for AgentResult.timedOut)
  └→ Task 11 (validation — independent)
       └→ Task 12 (run loop integration — needs 8–11)
            └→ Task 13 (new run flags — needs 12)
            └→ Task 14 (score/ tests — needs 4–8)
            └→ Task 15 (run loop tests — needs 9–12)
                 └→ Task 16 (docs)
                      └→ Task 17 (version bump)
```

### Validation

After all tasks:
```
npm test && npx tsc --noEmit && ralph doctor --ci && ralph grade --ci
```
Expected: all tests pass, typecheck clean, doctor 10/10, `ralph score` command functional, all acceptance criteria from `docs/product-specs/fitness-scoring.md` satisfied.
