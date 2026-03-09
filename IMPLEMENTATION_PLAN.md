# Implementation Plan — ralph-cli

## Current State

- **Version**: 0.1.1
- **Commands**: All 10 implemented (init, lint, grade, gc, doctor, plan, promote, ref, hooks, ci) + config validate
- **Tests**: 312 across 14 files — all passing
- **Dependencies**: Runtime: `commander`, `yaml`, `picocolors`. Dev: `typescript`, `vitest`, `eslint`, `@types/node`

## Release History

| Version | Date | Summary |
|---------|------|---------|
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

- [ ] Add to `src/config/schema.ts`: `AgentConfig`, `PromptsConfig`, `LoopConfig`, `ValidationConfig`, `GitConfig`, `RunConfig` interfaces. Add `run?: RunConfig | undefined` to `RalphConfig`. Add corresponding partial types to `RawRalphConfig`.
- [ ] Add to `src/config/defaults.ts`: `DEFAULT_AGENT`, `DEFAULT_RUN` with all default values from the spec's Defaults Table.
- [ ] Add to `src/config/loader.ts`: merge `run.*` fields with defaults in `mergeWithDefaults()`. Handle the nested `agent`, `plan-agent`, `build-agent`, `prompts`, `loop`, `validation`, `git` sub-objects.
- [ ] Files: `src/config/schema.ts`, `src/config/defaults.ts`, `src/config/loader.ts`
- [ ] Tests: Unit tests in existing `tests/config.test.ts` — verify RunConfig types are populated with defaults when `run` is absent, partially specified, and fully specified. Verify `plan-agent`/`build-agent` null handling.
- [ ] Done when: `loadConfig()` returns a `RalphConfig` with a fully-populated `run` field, and all existing tests still pass.

### Task 2: Run Types (`types.ts`)

Re-export types needed by other run modules and define the `AgentResult` interface.

- [ ] Create `src/commands/run/types.ts`
- [ ] Re-export `RunConfig`, `AgentConfig` etc. from `src/config/schema.ts` for convenience
- [ ] Define `AgentResult` interface: `{ exitCode: number, durationMs: number, error?: string | undefined }`
- [ ] Define `RunMode = 'plan' | 'build'`
- [ ] Define `RunOptions` interface for CLI options: `{ max?: number, agent?: string, model?: string, dryRun?: boolean, noCommit?: boolean, noPush?: boolean, resume?: boolean, verbose?: boolean }`
- [ ] Files: `src/commands/run/types.ts`
- [ ] Tests: No dedicated tests (type-only file). Verified by TypeScript compilation and consumers in later tasks.
- [ ] Done when: All run-related types are defined. `npx tsc --noEmit` passes.

### Task 3: Config Validation for `run.*`

Add validation for all `run.*` fields to the validator.

- [ ] Add `'run'` to `KNOWN_TOP_KEYS` in `src/config/validate.ts`
- [ ] Validate: `run.agent.cli` (non-empty string), `run.agent.args` (string array), `run.agent.timeout` (positive integer), `run.plan-agent`/`run.build-agent` (null or valid AgentConfig), `run.loop.max-iterations` (non-negative integer), `run.loop.stall-threshold` (non-negative integer), `run.git.commit-prefix` (non-empty string), `run.git.auto-commit`/`auto-push` (boolean), `run.prompts.plan`/`build` (null or string)
- [ ] Warn on unknown keys within `run.*` sub-objects
- [ ] Files: `src/config/validate.ts`
- [ ] Tests: Add validation tests in `tests/config.test.ts` — valid run config passes, invalid `agent.cli` (empty/missing), invalid `agent.timeout` (negative/zero), invalid `loop.max-iterations` (negative), unknown keys produce warnings, `plan-agent` with invalid shape errors.
- [ ] Done when: `ralph config validate` validates all `run.*` fields per spec. All existing validation tests still pass.

### Task 4: Auto-Detection (`detect.ts`)

Detect test commands, typecheck commands, and source paths from the project.

- [ ] Create `src/commands/run/detect.ts`
- [ ] `detectTestCommand(config: RalphConfig): string | null` — check config override first, then `package.json` scripts.test → `npm test`, `Makefile` test target → `make test`, `pyproject.toml` → `pytest`, `go.mod` → `go test ./...`, `Cargo.toml` → `cargo test`
- [ ] `detectTypecheckCommand(config: RalphConfig): string | null` — config override, then `tsconfig.json` → `npx tsc --noEmit`, `mypy.ini`/`pyproject.toml[tool.mypy]` → `mypy .`, `go.mod` → `go vet ./...`
- [ ] `detectSourcePath(config: RalphConfig): string` — union of `config.architecture.domains` paths, or conventional `src/` → `app/` → `lib/` → `.`
- [ ] `composeValidateCommand(testCmd: string | null, typecheckCmd: string | null): string` — join non-null components + `ralph doctor --ci` + `ralph grade --ci` with ` && `
- [ ] Files: `src/commands/run/detect.ts`
- [ ] Tests: `tests/run-detect.test.ts` — test each detection path (TS project with package.json, Python with pyproject.toml, Go with go.mod, Rust with Cargo.toml, Makefile). Test config override takes precedence. Test source path from domains vs conventional. Test `composeValidateCommand` composition with all/some/none detected.
- [ ] Done when: All 6 detection paths work. `composeValidateCommand` always includes `ralph doctor --ci && ralph grade --ci`.

### Task 5: Task Detection (`detect.ts` addition)

Detect completed tasks from IMPLEMENTATION_PLAN.md diffs for commit messages.

- [ ] Add to `src/commands/run/detect.ts`: `detectCompletedTask(planBefore: string): string | null`
- [ ] Read current `IMPLEMENTATION_PLAN.md`, diff line-by-line against `planBefore`
- [ ] Find first line where `[ ]` became `[x]` (case-insensitive) OR line gained a `✅` prefix/suffix
- [ ] Strip checkbox/emoji, trim whitespace, return task description
- [ ] Add `normalizePlanContent(content: string): string` — trim trailing whitespace per line, normalize `\r\n` → `\n` (used by loop for plan-mode completion check)
- [ ] Files: `src/commands/run/detect.ts`
- [ ] Tests: Add to `tests/run-detect.test.ts` — checkbox `[ ]` → `[x]` detected, `✅` detection, no match returns null, whitespace-only changes return null, multiple completions returns first, `normalizePlanContent` normalizes line endings and trailing whitespace.
- [ ] Done when: `detectCompletedTask` reliably finds the first newly-completed task. `normalizePlanContent` normalizes content for comparison.

### Task 6: Prompt Engine (`prompts.ts`)

Template variable substitution and built-in plan/build templates.

- [ ] Create `src/commands/run/prompts.ts`
- [ ] Define `PLAN_TEMPLATE` and `BUILD_TEMPLATE` as string constants (based on Huntley methodology — include `{validate_command}`, `{test_command}`, `{project_name}`, `{src_path}`, `{specs_path}`, `{date}`, `{skip_tasks}`, `{language}`, `{framework}`, `{typecheck_command}`)
- [ ] `generatePrompt(mode: 'plan' | 'build', config: RalphConfig, options: { skipTasks?: string }): string` — select template (built-in or custom file path from `config.run.prompts`), fill all `{variables}`, use auto-detection for unfilled validation fields
- [ ] Load custom templates from file paths when `config.run.prompts.plan`/`.build` is set
- [ ] Missing variables in custom templates → leave placeholder as-is (no error)
- [ ] Files: `src/commands/run/prompts.ts`
- [ ] Tests: `tests/run-prompts.test.ts` — built-in template variable substitution (all variables filled), custom template from file, `{validate_command}` composed correctly, missing optional variables handled, plan vs build template selection, unknown variables in custom templates left as-is.
- [ ] Done when: `generatePrompt('build', config)` returns a fully-substituted prompt string. Custom file templates work with same substitution.

### Task 7: Agent Abstraction (`agent.ts`)

Spawn agent in print mode, handle timeout, return result.

- [ ] Create `src/commands/run/agent.ts`
- [ ] `spawnAgent(config: AgentConfig, prompt: string, options?: { verbose?: boolean }): Promise<AgentResult>` — use `child_process.spawn`, pipe prompt to stdin, stream stdout/stderr if verbose, timeout via `AbortController`, return `{ exitCode, durationMs, error? }`
- [ ] Handle spawn failures: ENOENT → `{ exitCode: 1, durationMs: 0, error: "Agent CLI \"x\" not found..." }`, EACCES/ENOMEM/broken pipe similarly
- [ ] `resolveAgent(mode: 'plan' | 'build', runConfig: RunConfig, cliAgent?: string, cliModel?: string): AgentConfig` — implement 4-tier resolution: CLI flag > phase-specific > default > preset
- [ ] `AGENT_PRESETS` — preset args for known CLIs (no provider names in code — use generic CLI names only)
- [ ] `injectModel(args: string[], model: string): string[]` — scan for `--model`, replace value or append
- [ ] Files: `src/commands/run/agent.ts`
- [ ] Tests: `tests/run-agent.test.ts` — mock `child_process.spawn`. Test: successful spawn returns exit code + duration, timeout kills process and returns error, ENOENT returns error result, stdin piping sends prompt, verbose streams output. Test `resolveAgent` across all 4 tiers (CLI flag, phase-specific, default, preset). Test `injectModel` scan/replace/append/`=` form. Test preset args FULL REPLACE (not merge) when config sets args.
- [ ] Done when: `spawnAgent` spawns a process, pipes prompt, handles timeout/errors. `resolveAgent` implements spec's 4-tier resolution with worked examples passing.

### Task 8: Checkpoint / Progress Tracking (`progress.ts`)

Iteration tracking, checkpoint persistence, display formatting.

- [ ] Create `src/commands/run/progress.ts`
- [ ] `Checkpoint` interface: `{ version: 1, phase: 'plan' | 'build', startedAt: string, iteration: number, history: IterationRecord[] }`
- [ ] `IterationRecord`: `{ iteration: number, durationMs: number, exitCode: number, commit: string | null, error?: string | null }`
- [ ] `loadCheckpoint(): Checkpoint | null` — read `.ralph/run-checkpoint.json`, handle version mismatch (unknown version → delete + warn + return null)
- [ ] `saveCheckpoint(checkpoint: Checkpoint): void` — write to `.ralph/run-checkpoint.json`
- [ ] `deleteCheckpoint(): void`
- [ ] `printBanner(mode, agentConfig, runConfig): void` — formatted banner per spec
- [ ] `printIterationHeader(iteration: number): void`
- [ ] `printIterationSummary(iteration, result, commitHash, task): void`
- [ ] `printFinalSummary(reason: string, checkpoint: Checkpoint): void` — total iterations, duration, commit range, stop reason
- [ ] `formatDuration(ms: number): string` — human-readable (e.g., "4m 23s")
- [ ] Files: `src/commands/run/progress.ts`
- [ ] Tests: `tests/run-progress.test.ts` — checkpoint save/load round-trip, version mismatch deletes and warns, banner formatting, iteration summary formatting, final summary formatting, `formatDuration` edge cases (seconds only, minutes+seconds, hours).
- [ ] Done when: Checkpoint persists to `.ralph/run-checkpoint.json` and round-trips. All display functions produce output matching spec format.

### Task 9: The Loop (`index.ts`)

The main command entry point — orchestrates everything.

- [ ] Create `src/commands/run/index.ts`
- [ ] `runCommand(mode: RunMode, options: RunOptions): Promise<void>` — the full loop per spec pseudocode
- [ ] Load config, resolve agent, load/create checkpoint
- [ ] Plan mode: check specs exist (error if none), check existing plan (confirm regenerate)
- [ ] Build mode: check plan exists (prompt to run plan first, skip in non-TTY)
- [ ] Dirty working tree: warn + prompt (continue in non-TTY, skip with `--no-commit`)
- [ ] `--dry-run`: generate prompt, print it, exit
- [ ] Signal handling: SIGINT/SIGTERM → kill agent, save checkpoint, print summary, exit. Double SIGINT within 2s → force kill, exit 1
- [ ] Main loop: generate prompt → spawn agent → detect task → commit (if auto-commit + changes) → update checkpoint → check stall → check plan-mode completion → repeat
- [ ] Stall detection: N consecutive no-change iterations → prompt to continue (TTY) or halt (non-TTY)
- [ ] Git operations: `git add -A && git commit -m "..."`, optional `git push`
- [ ] Commit message: `"{prefix} {task}"` or `"{prefix} iteration {n}"` or `"{prefix} plan iteration {n}"`
- [ ] Files: `src/commands/run/index.ts`
- [ ] Tests: `tests/run.test.ts` — mock agent (script that modifies files predictably). Test: single iteration lifecycle, max iterations stops loop, stall detection halts, plan mode halts when plan unchanged, `--dry-run` prints prompt without executing, `--no-commit` skips git, `--resume` continues from checkpoint, signal handling saves checkpoint. These are integration-style tests using mocked child_process and fs.
- [ ] Done when: `runCommand('build', {})` executes the full loop lifecycle. All edge cases from spec handled.

### Task 10: CLI Registration

Wire `ralph run` into the commander CLI.

- [ ] Add `import { runCommand } from './commands/run/index.js'` to `src/cli.ts`
- [ ] Register `ralph run [mode]` with all options: `--max <n>`, `--agent <cli>`, `--model <model>`, `--dry-run`, `--no-commit`, `--no-push`, `--resume`, `--verbose`
- [ ] Default mode: `'build'`. Validate mode is `'plan'` or `'build'`.
- [ ] Files: `src/cli.ts`
- [ ] Tests: Verify CLI parses all options correctly (can test via commander's parse with mock argv). Verify `ralph run --help` shows correct usage.
- [ ] Done when: `ralph run`, `ralph run plan`, `ralph run --dry-run`, and all option combinations parse correctly and invoke `runCommand`.

### Task 11: Built-in Prompt Templates (Content)

Write the actual plan and build prompt template content.

- [ ] Refine `PLAN_TEMPLATE` and `BUILD_TEMPLATE` in `src/commands/run/prompts.ts`
- [ ] Plan template: instruct agent to read specs, produce/update IMPLEMENTATION_PLAN.md, use task sizing rules, include `{validate_command}` instructions
- [ ] Build template: instruct agent to read IMPLEMENTATION_PLAN.md, pick next unchecked task, implement it, run `{validate_command}`, commit guidance, mark task complete
- [ ] Both templates must be LLM-agnostic (no provider-specific instructions)
- [ ] Include all template variables from spec: `{project_path}`, `{project_name}`, `{src_path}`, `{specs_path}`, `{date}`, `{test_command}`, `{typecheck_command}`, `{validate_command}`, `{skip_tasks}`, `{language}`, `{framework}`
- [ ] Files: `src/commands/run/prompts.ts`
- [ ] Tests: Update `tests/run-prompts.test.ts` — verify templates contain all required variables, verify substitution produces valid prompt text, verify no provider-specific language in templates.
- [ ] Done when: Templates produce actionable prompts equivalent to the current `PROMPT_plan.md` / `PROMPT_build.md` approach. All variables substituted.

### Task 12: Integration Tests (Full Lifecycle)

End-to-end tests with a mock agent script covering the full loop.

- [ ] Create mock agent script: reads stdin, writes predictable files, exits with configurable code. Support modes: normal (modify files), no-change (exit without modifying), timeout (sleep forever), fail (exit 1), plan-complete (modify IMPLEMENTATION_PLAN.md then stop modifying)
- [ ] Test: Full build cycle — 3 iterations with mock agent, verify 3 commits created, checkpoint updated, summary printed
- [ ] Test: Plan mode completion — mock agent modifies plan on iteration 1, doesn't modify on iteration 2 → loop halts
- [ ] Test: Agent timeout — mock agent sleeps, verify timeout fires, iteration recorded with error, loop continues
- [ ] Test: `--resume` — run 2 iterations, stop, resume, verify iteration count continues
- [ ] Test: `--resume` phase mismatch — checkpoint from plan, run build with --resume, verify error/warning
- [ ] Test: Stall detection — mock agent makes no changes for 3 iterations → loop halts (non-TTY)
- [ ] Test: Custom prompt template — file-based template with variables, verify substitution in mock agent's stdin
- [ ] Test: Multi-agent resolution — configure plan-agent vs build-agent, verify correct agent spawned per mode
- [ ] Test: `--dry-run` — verify prompt printed to stdout, no agent spawned
- [ ] Test: Signal handling — send SIGINT during iteration, verify checkpoint saved
- [ ] Files: `tests/run-integration.test.ts`, `tests/fixtures/mock-agent.js` (or inline)
- [ ] Tests: All scenarios above
- [ ] Done when: All 10 integration scenarios pass. Branch coverage ≥80% across all `src/commands/run/*.ts` files.

### Task 13: ARCHITECTURE.md + AGENTS.md Updates

Update project documentation to reflect the new `run` domain.

- [ ] Add `run` domain to ARCHITECTURE.md domain table: `run | src/commands/run | Autonomous build loop (agent spawn, prompts, progress)`
- [ ] Update AGENTS.md command list to include `ralph run` with usage examples
- [ ] Update IMPLEMENTATION_PLAN.md command status table to include `ralph run`
- [ ] Files: `ARCHITECTURE.md`, `AGENTS.md`, `IMPLEMENTATION_PLAN.md`
- [ ] Tests: No code tests. Verify `ralph doctor` still passes (it checks for ARCHITECTURE.md consistency).
- [ ] Done when: All three docs updated. `ralph doctor` passes.

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
