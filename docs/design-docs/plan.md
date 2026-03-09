# plan — Domain Overview

## Purpose

`ralph plan` manages execution plan lifecycle: create, complete, abandon, list,
and status. Plans are Markdown files stored under `docs/plans/` with a
standardised template covering tasks, decision log, and tech-debt tracking.

## Usage

```bash
ralph plan create "Add OAuth support"  # Create new numbered plan
ralph plan status                       # Show active plan summary
ralph plan complete                     # Mark active plan done
ralph plan abandon                      # Abandon with reason
ralph plan list                         # List active and completed plans
ralph plan list --json                  # Machine-readable list
```

## Config

No dedicated config section. Plans are stored at `docs/plans/active/` and
`docs/plans/completed/`. These paths are conventional and not currently
overridable.

## Architecture

```
src/commands/plan/
  index.ts   — All subcommands: create, status, complete, abandon, list
```

Plans use sequential numeric IDs (`000-slug.md`) that persist when a plan
moves from `active/` to `completed/`. Layer position: `commands/plan` →
`config` (loadConfig, findProjectRoot), `utils/output`, `utils/fs`.

## Design Decisions

**Plans are Markdown, not a database.** Human and agent readability is the
primary goal. Markdown files can be read without tooling, committed to git,
and reviewed as diffs. A database would require a query interface and a
migration path.

**IDs survive directory transitions.** Completing a plan moves its file from
`active/` to `completed/`; the numeric ID in the filename is preserved. The
ID counter scans both directories so references in commits and PRs remain
stable.

**Keyword-driven task generation.** `ralph plan create` detects action words
in the title (fix, migrate, add, refactor) and generates a starter task list.
This reduces blank-page friction without imposing a rigid workflow — all
generated tasks can be freely edited.
