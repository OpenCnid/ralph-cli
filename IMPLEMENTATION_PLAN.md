# Implementation Plan — ralph-cli

## Current State

- **Version**: 0.2.2
- **Commands**: All 11 implemented (init, lint, grade, gc, doctor, plan, promote, ref, hooks, ci, run) + config validate. `ralph review` not yet started.
- **Tests**: 524 across 21 files — all passing
- **Next**: v0.3.0 (`ralph review`)
- **Dependencies**: Runtime: `commander`, `yaml`, `picocolors`. Dev: `typescript`, `vitest`, `eslint`, `@types/node`

## Release History

| Version | Date | Summary |
|---------|------|---------|
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

## Deferred Items

- **Lint --fix for structural rules** — Autofix infrastructure in place (naming-convention + custom YAML `autofix.replace`). File-size, dependency-direction, domain-isolation, file-organization report only — auto-fix not feasible without human judgment.

## Notes

- **LLM-agnostic**: Zero references to specific AI providers or models anywhere. Hard constraint.
- **ESM only**: `import` statements, never `require()`. `.ts` imports resolve to `.js` in output.
- **`exactOptionalPropertyTypes`**: Optional props need `| undefined`.
- **YAML 1.2**: Single-quote regex patterns with backslashes in `.yml` files.
- **Test isolation**: Tests `chdir()` to temp dirs with `.git/` stubs. Restore `origCwd` in `afterEach`.

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

- [ ] Create `src/commands/review/DESIGN.md`, `docs/design-docs/review.md`, `docs/design-docs/review/DESIGN.md` covering diff extraction, context assembly, prompt generation, output formats, and agent reuse from `run`.
- [ ] Each file 30–100 lines with sections: Purpose, Usage, Config, Architecture, Design Decisions.
- [ ] Files: 3 new doc files.
- [ ] Done when: `ralph grade` shows A for `review` docs dimension.

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
