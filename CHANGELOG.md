# Changelog

All notable changes to ralph-cli are documented here. Reverse chronological.

## [0.1.1] — 2026-03-08

Spec: `docs/product-specs/v0.1.1-patch.md`. 7 items (P0–P6).

### Added

- **Interactive `ralph init`**: No flags → interactive mode (shows detection, prompts for name/description/language). `--defaults` unchanged. Falls back to defaults in non-TTY.
- **Prompt utilities** (`src/utils/prompt.ts`): `ask()`, `confirm()`, `select()` using `node:readline/promises`. Zero new dependencies. TTY detection returns defaults in CI/pipes. Stream injection for testing.
- **Doctor `--fix` confirmation**: Shows fixable issues list and asks for confirmation before running init. Auto-proceeds in non-TTY/CI.
- **Ref discover prompting**: Prompts to add discovered references after listing. Supports "a" for all, comma-separated numbers, or Enter to skip.
- **Custom YAML autofix**: YAML rules now support `autofix.replace` for simple pattern replacement via `ralph lint --fix`.
- **README.md**: Publish-ready README covering all 10 commands, escalation ladder, config, custom rules, CI, philosophy.
- **AGENTS.md rewrite**: Converted to agent-optimized navigation table (67 lines).

### Fixed

- **Grade crash**: `ralph grade` no longer crashes when `.ralph/` directory doesn't exist. `ensureDir()` called before history file writes in both grade and GC.
- **GC orphan false positives**: Test-to-source mapping now handles `<dirname>.test.ts` → `<dirname>/index.ts` pattern. Also checks for `index.*` in same directory.

### Stats

- 312 tests across 14 files — all passing.

---

## [0.0.32] — 2026-03-07

Specs-only alignment, no code changes.

- Config spec: `architecture.files` → `architecture.rules` to match 0.0.28 rename.
- Config spec: added `direction: forward-only` field.
- Architectural enforcement spec: `max-file-lines` → `max-lines` to match schema.
- Architectural enforcement spec: removed `rules.custom` array (auto-discovery makes it unnecessary).

## [0.0.31] — 2026-03-07

- `ralph promote pattern` creates files in `docs/design-docs/patterns/` subdirectory (was flat in `docs/design-docs/`).
- `ralph init` creates `docs/design-docs/patterns/` directory.
- `promote list` scans `patterns/` subdirectory.
- Taste-escalation spec path corrected: `docs/design/patterns/` → `docs/design-docs/patterns/`.
- 3 new tests for `plan list --all` (text, JSON, default exclusion).

## [0.0.30] — 2026-03-07

- Script-based custom lint rules (`.ralph/rules/*.js`). Receives JSON on stdin, outputs structured violations. 30-second timeout.

## [0.0.29] — 2026-03-07

- Grade trend labels include contextual reasons from dimension scoring (e.g., `billing/docs: F (was D last week) — degraded — 0/5 domain documentation files present`).
- Detail strings stored in grade history for cross-snapshot comparison.

## [0.0.28] — 2026-03-07

- GC dead code items include git context (last commit that referenced the file via `git log -S`).
- Config schema rename: `architecture.files` → `architecture.rules` across entire config system.
- Added `direction: forward-only` field to `ArchitectureConfig`.

## [0.0.27] — 2026-03-06

- GC cross-run deduplication via item fingerprints. Persistent items flagged with run count.
- GC stale docs git context: reports commit hash and days since deletion for missing referenced files.
- Grade temporal trend context (e.g., "was B yesterday", "was D last week").

## [0.0.26] — 2026-03-06

- Doctor detects Python linters (ruff, pylint, flake8) from `pyproject.toml` and Go linters (golangci-lint) from config files.
- Grade per-dimension sustained degradation/improvement detection (3+ consecutive drops/improvements per dimension).
- Lint type naming convention enforcement for exported `type` and `interface` declarations.

## [0.0.25] — 2026-03-06

- GC `--category` validation warns on invalid categories.
- Grade stable trend indicator (unchanged dimensions report "stable").
- Plan `--full` includes `Estimated scope: N–M tasks`.
- Plan tech debt tracker columns and priority levels aligned to spec.

## [0.0.24] — 2026-03-06

- CI environment auto-detection from standard env vars (`CI`, `GITHUB_ACTIONS`, `GITLAB_CI`, etc.). Config `ci:` overrides applied automatically.
- `ralph doctor --ci` and `ralph grade --ci` flags wired through to config loader.
- Exported `detectCiEnvironment()` utility.

## [0.0.23] — 2026-03-06

- Doctor reports LLM reference line numbers. Added "claude" and "copilot" to detected terms.
- Product-specs file count in doctor output.
- Architecture doc domain/section count in doctor output.
- Fix summary shows target score label.

## [0.0.22] — 2026-03-05

- `ralph lint --fix` autofix infrastructure. `LintFixResult` interface, optional `autofix` method on rules.
- Naming-convention autofix: renames non-conforming exports, updates cross-file imports.
- Ref discover test timeout fix.

## [0.0.21] — 2026-03-05

- `ralph ref discover`: scans package.json/pyproject.toml/go.mod, checks common llms.txt URL patterns via HEAD requests.
- Pre-commit hook lint on staged source files only.

## [0.0.20] — 2026-03-05

- `ralph init` generates complete `.ralph/config.yml` with all sections.
- `ralph ref add` preserves source extension (`.md` → `-llms.md`, `.txt` → `-llms.txt`).
- CI template caching (GitHub Actions `actions/cache@v4`, GitLab `cache:` directive).

## [0.0.19] — 2026-03-05

- `ralph plan create` generates context-aware task suggestions based on plan title. Six action categories with fallback.

## [0.0.18] — 2026-03-05

- Doctor "tests run successfully" backpressure check. Executes test command, verifies exit 0. 60-second timeout.

## [0.0.17] — 2026-03-05

- GC pattern inconsistency includes first-occurrence line numbers per file.
- `ralph promote lint --from <doc>` records provenance. `promote list` shows escalation path.

## [0.0.16] — 2026-03-04

- `promote list` shows lint rule violation counts from live codebase scan.

## [0.0.15] — 2026-03-04

- GC `--category <category>` filter.
- GC `--fix-descriptions` writes `.ralph/gc-fix-descriptions.md`.
- `ralph plan list --json` and `ralph plan status --json`.
- Grade action items include specific file names and line counts.

## [0.0.14] — 2026-03-04

- Quality Grades title (was "Quality Score"). Last updated timestamp. Spec-compliant trend format.
- `ralph plan complete --reason`.

## [0.0.13] — 2026-03-04

- Promote doc format: `- **principle.** Added DATE.` (spec-compliant). Backward compatible parsing.
- User-defined GC anti-patterns via `.ralph/gc-patterns/*.yml`.

## [0.0.12] — 2026-03-04

- Doctor `--fix` async fix. Test files exist backpressure check.
- `ralph plan create` auto-creates `tech-debt-tracker.md`.

## [0.0.11] — 2026-03-03

- GC golden principle violations (4 built-in anti-patterns). Principle parsing from core-beliefs.md and domain docs.
- GC pattern consistency expansion (export style, null-checking).
- GC trend tracking via `.ralph/gc-history.jsonl`.

## [0.0.10] — 2026-03-03

- Lint `file-organization` rule (business logic in utils/ detection via 3 heuristics).
- GC dead code detection (exports with no importers, orphaned test files, import graph analysis).

## [0.0.9] — 2026-03-03

- Per-domain grade scoring. Domain-scoped coverage parsing (lcov, Go). Domain-specific doc scoring. Multi-domain and single-domain output.

## [0.0.8] — 2026-03-03

- Lint `domain-isolation` rule (cross-domain import prevention, cross-cutting exemptions).
- Doctor enhancements: commit check, lint rules check, category-level status, fix summary.

## [0.0.7] — 2026-03-02

- Comprehensive config validation: nested unknown key warnings, type validation for all fields, array content validation, domain validation, references validation, paths validation, CI validation.

## [0.0.6] — 2026-03-02

- Multi-format coverage parsing: Cobertura XML, Go coverage profiles, auto-detection fallback.

## [0.0.5] — 2026-03-02

- Grade staleness dimension (5th dimension). `--trend` output with history. Sustained degradation/improvement detection. Quality.md trends section.

## [0.0.4] — 2026-03-01

- `ralph hooks` and `ralph ci` (P9: Integration).

## [0.0.3] — 2026-03-01

- `ralph promote` (P7: Taste Escalation), `ralph ref` (P8: References).

## [0.0.2] — 2026-03-01

- `ralph lint` (P2: Architectural Enforcement).

## [0.0.1] — 2026-03-01

- Foundation: CLI router, config system, utilities (P0).
- `ralph init` (P1: Repo Scaffolding).
