# plan — Design Reference

## Purpose

Execution plan lifecycle management: create, complete, abandon, list, and show
status of structured plans stored in `docs/plans/`. Plans are Markdown files
with a standardised template including decision log and tech-debt tracking.

## Usage

```bash
ralph plan create "Add OAuth support"  # Create new plan (opens in editor)
ralph plan status                       # Show active plan summary
ralph plan complete                     # Mark active plan done, move to completed/
ralph plan abandon                      # Abandon active plan with reason
ralph plan list                         # List all active and completed plans
ralph plan list --json                  # Machine-readable plan list
```

## Config

No dedicated config section. Plans are stored under `docs/plans/` by default
(`active/` and `completed/` subdirectories).

## Architecture

| File | Responsibility |
|------|----------------|
| `src/commands/plan/index.ts` | All subcommands: create, status, complete, abandon, list |

Plan files use sequential numeric IDs (`000-slug.md`, `001-slug.md`) that
persist across active → completed transitions. IDs are computed by scanning
both directories for the highest existing numeric prefix.

Layer position: `commands/plan` → `config` (loadConfig, findProjectRoot),
`utils/output`, `utils/fs`.

## Design Decisions

**Plans are Markdown files, not a database.** Human and agent readability is
the primary goal. A Markdown file can be read without tooling, committed to
git, and diffed in code review. A database would require a migration strategy
and a query interface.

**Sequential IDs survive directory moves.** When a plan is completed, it moves
from `active/` to `completed/`. The numeric ID is preserved in the filename so
references (in commit messages, PRs, comments) stay stable. The ID counter
scans both directories so IDs never collide.

**Template-generated tasks from title keywords.** `ralph plan create` generates
a starter task list by matching keywords in the plan title (fix, migrate, add,
refactor). This reduces blank-page friction without locking contributors into a
rigid workflow — the tasks are suggestions that can be freely edited.
