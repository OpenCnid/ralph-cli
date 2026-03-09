# ref — Detailed Design

## Storage Layout

```
docs/references/
  vitest-llms.txt          # Fetched from https://vitest.dev/llms.txt
  typescript-llms.md       # Fetched from https://docs.typescriptlang.org/llms.md
  local-api-llms.txt       # Copied from local path
```

## Metadata Format

Every stored file starts with:
```
<!-- ralph-ref: source=https://original.url fetched=YYYY-MM-DD -->
```

`ref list` extracts source and date from this comment. `ref update` uses the
source URL to re-fetch (skips local files — no source URL prefix).

## Filename Resolution

1. If `--name` flag provided: use it directly + `-llms.{ext}`
2. For URLs: extract hostname, strip `www.`, use first domain segment
3. For local files: strip extension and `-llms` suffix from basename
4. Sanitize: lowercase, replace non-alphanumeric with `-`

Extension rule: source ends in `.md` → store as `-llms.md`; otherwise `-llms.txt`.

## Discovery Algorithm

For each dependency extracted from `package.json` / `pyproject.toml` / `go.mod`:

1. Generate 4-6 candidate URLs (common documentation hosting patterns)
2. Send HEAD request with 5s timeout, follow redirects
3. On first `2xx` response: record `{ name, url }` and stop for this dependency
4. Deduplicate URLs across dependencies to avoid redundant checks
5. Present results to user for interactive selection (TTY) or list (non-TTY)

## Size Warning Logic

After every `add` or `update`, `checkSizeWarnings()` scans the references
directory and emits warnings via `warn()` for:
- Any single file exceeding `warn-single-file-kb`
- Total directory size exceeding `max-total-kb`

## Design Decisions

**Interactive discover uses numbered selection.** Users can enter `1,3` to
add specific references, `a` to add all, or press Enter to skip. This
parallels `ralph init`'s interactive style and avoids silent bulk downloads.

**No central registry or manifest file.** The metadata comment approach keeps
the solution self-contained. Any tool can inspect reference files without
needing to understand a ralph-specific index format.
