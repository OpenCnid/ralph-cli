# init — Domain Overview

## Purpose

`ralph init` bootstraps a new project with the full ralph-cli documentation and
configuration skeleton. It detects the language and framework from existing project
files and generates tailored stubs for architecture docs, product specs, exec plans,
quality tracking, and the ralph config file.

## Usage

```bash
ralph init                  # Interactive: prompts for name, confirms language/framework
ralph init --defaults       # Silent: accept all detected values, no prompts
```

Run once when adopting ralph-cli in a new repository. Re-running is safe — all
generated files are skipped if they already exist.

## Config

The command generates `.ralph/config.yml` but does not read one. Generated config
includes:

- `project.name` and `project.language` from detection or user input
- `architecture.domains` seeded with a conventional `src/` entry
- `quality.coverage` preset for the detected test runner
- `paths.*` pointing to the generated directory structure

## Architecture

```
src/commands/init/
  index.ts       — entry point: orchestrate detection → prompts → write files
  detect.ts      — infer language/framework from package.json / pyproject.toml / go.mod / Cargo.toml
  templates.ts   — pure functions returning file content strings
```

Detection precedence: `package.json` (TypeScript/JavaScript) → `pyproject.toml`
(Python) → `go.mod` (Go) → `Cargo.toml` (Rust) → default TypeScript.

Layer position: `commands` → imports from `config` (findProjectRoot) and `utils`
(ensureDir, safeWriteFile, output). No imports from other command domains.

## Design Decisions

**Skip-if-exists prevents data loss.** Every generated file is only written if it
does not already exist. This allows teams to customise scaffolded files freely and
re-run `init` in partially-initialised repos without overwriting their work.

**Templates are pure functions.** File content is separated from file-writing logic.
`templates.ts` contains only string-returning functions; `index.ts` handles paths and
I/O. This makes templates independently testable and easy to review as a diff.

**Language detection is heuristic, not authoritative.** Detection reads well-known
manifest files and extracts signals (deps, module names). The interactive mode always
lets the user correct the detected values. There is no hard error if detection fails —
it falls back to TypeScript defaults.
