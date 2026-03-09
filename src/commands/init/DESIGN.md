# init — Design Notes

## Purpose

Scaffolds a new ralph-cli project by generating the standard directory structure,
documentation stubs, and `.ralph/config.yml` tailored to the detected language and
framework. Runs once per project; subsequent invocations skip existing files.

## Usage

```bash
ralph init                  # Interactive mode (prompts for project name, language)
ralph init --defaults       # Non-interactive, accept all detected values
```

## Config

`ralph init` creates `.ralph/config.yml`. It does not read an existing config — the
command is designed to run before one exists.

## Architecture

Key files in `src/commands/init/`:

| File | Role |
|------|------|
| `index.ts` | Entry point — orchestrates detection, prompts, and file generation |
| `detect.ts` | Reads `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml` to infer language/framework |
| `templates.ts` | Pure functions returning file content strings for every generated file |

Detection order: `package.json` → `pyproject.toml` → `go.mod` → `Cargo.toml` → default TypeScript.

The command is in the `src/commands/` layer and imports from `src/config/` (for
`findProjectRoot`) and `src/utils/` (for I/O helpers). It does not depend on any
other command domain.

## Design Decisions

**Skip-if-exists semantics.** `init` never overwrites existing files. This makes it
safe to re-run in a project that has been partially initialised and allows teams to
customise generated files without risk of losing changes.

**Templates as pure functions.** All file content lives in `templates.ts` as
functions that accept project metadata and return strings. This keeps `index.ts`
focused on orchestration and makes templates easy to test and diff independently.

**Interactive vs `--defaults`.** Interactive mode is gated on `process.stdin.isTTY`,
so the command is safe to run in CI pipelines with `--defaults` (or when stdin is not
a terminal). The detected values always serve as the default answers, minimising the
number of questions a human must answer.
