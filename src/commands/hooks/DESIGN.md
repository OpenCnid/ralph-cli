# hooks — Design

## Purpose

`ralph hooks` installs and manages git hooks that enforce code quality checks
at commit and push boundaries. Hooks are non-invasive: they skip gracefully
if ralph is not installed and never overwrite non-ralph hooks without warning.

## Usage

```bash
ralph hooks install             # Install pre-commit hook (default)
ralph hooks install --all       # Install all three hooks
ralph hooks install --hooks pre-commit,pre-push
ralph hooks uninstall           # Remove all ralph-managed hooks
```

## Config

No dedicated config section. Hooks are written to:
- `.git/hooks/<name>` — active git hook (executable shell script)
- `.ralph/hooks/<name>` — canonical copy tracked alongside ralph config

## Architecture

```
src/commands/hooks/
  index.ts  — hooksInstallCommand, hooksUninstallCommand; HOOK_SCRIPTS constant
```

Layer position: `commands/hooks` → `config/findProjectRoot`, `utils/fs`,
`utils/output`. No external dependencies.

## Hook Definitions

| Hook | Trigger | Action |
|------|---------|--------|
| `pre-commit` | Before each commit | `ralph lint` on staged source files |
| `post-commit` | After each commit | `ralph grade` (informational, non-blocking) |
| `pre-push` | Before push | `ralph doctor --ci` (blocks on failure) |

## Design Decisions

**Shell scripts, not Node.js hooks.** Git hooks must be executable shell
scripts. Using `#!/bin/sh` with no Node.js dependencies makes the hooks
work in any environment where ralph is globally installed, without requiring
the project's own Node environment to be active.

**Staged-files filtering in pre-commit.** The pre-commit hook filters to
`.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.go`, `.rs` files via `git diff
--cached`. This avoids running lint on documentation, config, or binary
files that cannot trigger lint violations, keeping commits fast.

**Dual-write to `.ralph/hooks/` enables version control.** Copying hook
scripts to `.ralph/hooks/` lets teams commit the hooks alongside the ralph
config. New team members or fresh environments can reinstall hooks from this
copy rather than generating them from scratch.
