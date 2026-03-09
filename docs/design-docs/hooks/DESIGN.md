# hooks — Detailed Design

## Hook Scripts

### pre-commit
```sh
#!/bin/sh
# ralph-cli pre-commit hook
STAGED=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx|js|jsx|py|go|rs)$' || true)
if [ -z "$STAGED" ]; then
  exit 0
fi
ralph lint
```

Exits 0 immediately when no staged source files exist. When source files are
staged, runs `ralph lint` (full project scan). Non-zero exit code blocks the
commit.

### post-commit
```sh
ralph grade 2>/dev/null || true
```

Runs grade for informational feedback only. `|| true` ensures the hook always
exits 0 — it cannot block a commit that has already been created.

### pre-push
```sh
ralph doctor --ci
```

Runs doctor in CI mode (non-zero exit on any failure). Blocks the push if
health checks fail.

## Installation Logic

1. Validate `.git/` directory exists (error if not a git repo)
2. `ensureDir('.git/hooks/')` and `ensureDir('.ralph/hooks/')`
3. For each hook to install:
   a. Write script to `.ralph/hooks/<name>` with chmod 755
   b. Check if `.git/hooks/<name>` exists
      - If exists and contains `ralph-cli`: overwrite (safe update)
      - If exists and does NOT contain `ralph-cli`: `warn()` and skip
      - If absent: write and chmod 755

## Uninstall Logic

For each hook name in `HOOK_SCRIPTS`:
1. Read `.git/hooks/<name>` if it exists
2. If content contains `ralph-cli`: `unlinkSync()`
3. Remove all files in `.ralph/hooks/`

## Design Decisions

**`--all` vs `--hooks` flags.** `--all` is a convenience alias for installing
every defined hook. `--hooks` accepts a comma-separated list for selective
installation. The default (no flag) installs only `pre-commit`, which is the
most commonly needed hook and has zero performance cost when no files are staged.

**Hook content is embedded, not read from `.ralph/hooks/`.** The source of
truth for hook scripts is the `HOOK_SCRIPTS` constant in `index.ts`. This
ensures that `ralph hooks install` always installs the current canonical
version, even if `.ralph/hooks/` contains an older copy from a previous
ralph version.
