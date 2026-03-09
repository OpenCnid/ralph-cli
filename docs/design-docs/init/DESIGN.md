# init — Design Reference

## Purpose

Project scaffolding command. Generates the directory structure, documentation stubs,
and `.ralph/config.yml` for a new repository. Detection is automatic; interactive
prompts let the user override detected values.

## Usage

```bash
ralph init               # Interactive (TTY required)
ralph init --defaults    # Accept all detected values without prompting
```

## Config

`ralph init` produces `.ralph/config.yml`. It does not consume an existing config.

## Architecture

| File | Responsibility |
|------|----------------|
| `src/commands/init/index.ts` | Orchestration: detect → prompt → mkdir → write |
| `src/commands/init/detect.ts` | Language/framework detection from manifest files |
| `src/commands/init/templates.ts` | File content as pure string-returning functions |

**Generated file set (16 files):**
- Documentation: `AGENTS.md`, `ARCHITECTURE.md`, `docs/DESIGN.md`, `docs/RELIABILITY.md`, `docs/SECURITY.md`, `docs/PLANS.md`, `docs/QUALITY_SCORE.md`
- Doc indexes: `docs/design-docs/index.md`, `docs/design-docs/core-beliefs.md`, `docs/product-specs/index.md`, `docs/exec-plans/index.md`, `docs/exec-plans/tech-debt-tracker.md`
- Config: `.ralph/config.yml`
- Placeholders: `docs/generated/.gitkeep`, `docs/references/.gitkeep`, `.ralph/rules/.gitkeep`

## Design Decisions

**Idempotent by default.** Files are never overwritten; re-running `init` on an
existing project is safe and only creates missing files.

**Template functions, not template strings.** Each generated file is produced by a
named function in `templates.ts` that receives project metadata. This makes the
generation logic discoverable, testable, and easy to update without touching
orchestration code.

**No config dependency.** `init` must work before any `.ralph/config.yml` exists. It
uses only `findProjectRoot` from the config module and writes its own config from
scratch.
