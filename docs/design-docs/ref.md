# ref — Domain Overview

## Purpose

`ralph ref` manages a local library of LLM-friendly external documentation.
It fetches and stores reference files in the `-llms.txt` / `-llms.md` format,
keeping AI agents informed about external APIs and libraries without requiring
live internet access during an agent session.

## Usage

```bash
ralph ref add https://example.com/llms.txt    # Fetch and store
ralph ref add local-docs/api.md --name myapi  # Copy local file
ralph ref list                                # List stored references
ralph ref list --sizes                        # With size breakdown
ralph ref update                              # Refresh all URL refs
ralph ref discover                            # Auto-find llms.txt for deps
ralph ref remove myapi                        # Delete a reference
```

## Config

```yaml
paths:
  references: docs/references

references:
  max-total-kb: 500       # Total size budget warning
  warn-single-file-kb: 100
```

## Architecture

```
src/commands/ref/
  index.ts  — All five subcommand handlers; fetch, store, metadata extraction
```

Uses native `fetch` (Node 22+). Files stored at `{references}/{name}-llms.{txt,md}`.
Layer position: `commands/ref` → `config`, `utils/fs`, `utils/prompt` (discover
interactive selection).

## Design Decisions

**Self-describing files via metadata comments.** Each stored file embeds
`<!-- ralph-ref: source=URL fetched=DATE -->` as its first line. This
eliminates any external index or database — all operational data is inside the
files themselves.

**Size budgets prevent context window bloat.** LLM context windows have fixed
limits. The `max-total-kb` and `warn-single-file-kb` settings trigger warnings
before the reference library becomes a liability. Agents benefit from targeted,
small references rather than entire documentation sites.

**`discover` uses HEAD requests with a 5-second timeout.** Probing many
candidate URLs could be slow. HEAD requests avoid downloading content just to
check existence, and the timeout prevents one slow host from blocking the whole
scan. Only confirmed URLs are shown to the user for selective adoption.
