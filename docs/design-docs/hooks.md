# hooks — Domain Overview

## Purpose

`ralph hooks` installs git hooks that enforce quality gates at commit and push
time. It manages three hooks (pre-commit, post-commit, pre-push) and never
silently overwrites user-defined hooks.

## Usage

```bash
ralph hooks install              # Install pre-commit hook only
ralph hooks install --all        # Install all three hooks
ralph hooks install --hooks pre-commit,pre-push
ralph hooks uninstall            # Remove all ralph-managed hooks
```

## Config

No dedicated config section. Written to `.git/hooks/` and `.ralph/hooks/`.

## Architecture

```
src/commands/hooks/
  index.ts  — hooksInstallCommand, hooksUninstallCommand
               HOOK_SCRIPTS: Record<string, string> — embedded shell scripts
```

Layer position: thin command layer. Only deps: `config/findProjectRoot`,
`utils/fs`, `utils/output`. All hook content is inlined as string constants.

## Design Decisions

**Three-tier enforcement model.** pre-commit is blocking and fast (lint only).
post-commit is informational (grade report, never blocks). pre-push is the
final gate (doctor --ci). This gives developers immediate feedback on quality
without slowing down every commit with a full suite.

**Non-destructive install.** If a non-ralph hook already exists at a target
path, `install` warns and skips rather than overwriting. This respects existing
tooling (Husky, lefthook, etc.). Reinstalling ralph hooks is safe — existing
ralph hooks are replaced with the current script template.

**Uninstall is content-aware.** `uninstall` only removes hooks whose content
contains `ralph-cli`, ensuring it cannot accidentally delete unrelated hooks
that happen to share a name.
