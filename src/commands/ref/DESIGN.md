# ref — Design

## Purpose

`ralph ref` manages LLM-friendly external documentation stored locally in
the project. It fetches, stores, and refreshes reference files in the
`-llms.txt` / `-llms.md` format so AI agents always have current library
docs to consult.

## Usage

```bash
ralph ref add <url>           # Fetch URL and store as -llms.txt reference
ralph ref add <path>          # Copy local file as reference
ralph ref add <url> --name vitest   # Override generated filename
ralph ref list                # List all references with source and date
ralph ref list --sizes        # Show size breakdown with usage bar
ralph ref update              # Re-fetch all URL-sourced references
ralph ref update vitest       # Re-fetch specific reference
ralph ref discover            # Scan dependencies for available llms.txt files
ralph ref remove vitest       # Delete a reference file
```

## Config

```yaml
paths:
  references: docs/references   # Storage directory for reference files

references:
  max-total-kb: 500             # Warn when total exceeds this
  warn-single-file-kb: 100      # Warn when one file exceeds this
```

## Architecture

```
src/commands/ref/
  index.ts  — refAddCommand, refListCommand, refUpdateCommand,
               refDiscoverCommand, refRemoveCommand; all in one file
```

Layer position: `commands/ref` → `config`, `utils/fs`, `utils/output`, native
`fetch` (no external HTTP library). Storage: `{references}/name-llms.{txt,md}`.

## Design Decisions

**Metadata comment in every file preserves traceability.** Each stored file
begins with `<!-- ralph-ref: source=URL fetched=DATE -->`. This makes `ref
list` and `ref update` work without a separate index file — all provenance data
is embedded in the file itself.

**File naming follows `-llms.txt` convention.** The `llms.txt` standard uses
this suffix to signal LLM-optimized content. Ralph preserves the `.md` or
`.txt` extension from the source and appends `-llms` to the base name,
making it easy for agents to glob for reference files.

**`discover` probes multiple URL patterns per dependency.** For each
dependency, it tries `docs.name.dev/llms.txt`, `name.dev/llms.txt`,
`docs.name.com/llms.txt`, `name.com/llms.txt`. This covers the common
documentation hosting patterns without requiring a central registry.
