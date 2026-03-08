# References

The `docs/references/` directory stores LLM-friendly documentation for external tools and libraries, making them directly accessible to agents working in the repo.

## Job

When an AI agent needs to use an external library or tool, it either searches the internet (slow, unreliable), relies on training data (possibly outdated), or hallucinates the API (dangerous). The developer needs a way to bundle the specific external documentation that matters for this project, in a format agents can consume directly — so agents work with accurate, current API details without leaving the repo.

## The llms.txt Convention

Many tools and libraries now publish `llms.txt` files — condensed, agent-readable summaries of their documentation. These are designed to be included in LLM context directly.

Examples from the wild:
- Framework documentation condensed to essential API reference
- Component library props and usage patterns
- CLI tool flag references and common patterns
- Deployment platform configuration guides

The `docs/references/` directory collects these for the project's specific dependencies.

## How It Works

### Adding References

```bash
ralph ref add <url-or-path> [--name <filename>]
```

**From a URL:**
```bash
ralph ref add https://docs.example.com/llms.txt
# Downloads to docs/references/example-llms.txt

ralph ref add https://docs.example.com/llms.txt --name my-framework
# Downloads to docs/references/my-framework-llms.txt
```

**From a local file:**
```bash
ralph ref add ./external-docs/api-reference.md --name payment-api
# Copies to docs/references/payment-api-llms.txt
```

**From llms.txt discovery:**
```bash
ralph ref discover
# Scans package.json / pyproject.toml / go.mod for dependencies
# Checks if each dependency publishes an llms.txt
# Prompts to add discovered references
```

### Listing References

```bash
ralph ref list

References (docs/references/):
  design-system-reference-llms.txt    42KB   added 2026-03-01
  stripe-api-llms.txt                 18KB   added 2026-03-05
  nextjs-llms.txt                     67KB   added 2026-03-07
```

### Updating References

```bash
ralph ref update                       # re-fetches all references from original URLs
ralph ref update stripe-api            # update a specific reference
```

References track their source URL in a metadata comment at the top of the file:

```
<!-- ralph-ref: source=https://docs.stripe.com/llms.txt fetched=2026-03-07 -->
```

This allows `ralph ref update` to re-fetch from the original source.

### Removing References

```bash
ralph ref remove stripe-api
# Deletes docs/references/stripe-api-llms.txt
```

### Size Management

LLM context is finite. Large reference files crowd out the actual task. ralph-cli tracks reference sizes and warns when the total exceeds a configurable threshold:

```bash
ralph ref list --sizes

Total reference size: 127KB (limit: 200KB)
  nextjs-llms.txt              67KB  ███████████████░░░░░  33%
  design-system-llms.txt       42KB  ██████████░░░░░░░░░░  21%
  stripe-api-llms.txt          18KB  ████░░░░░░░░░░░░░░░░   9%

⚠️  Consider splitting large references or removing unused ones.
```

The size limit is configurable in `.ralph/config.yml`:

```yaml
references:
  max-total-kb: 200
  warn-single-file-kb: 80
```

### AGENTS.md Integration

`ralph init` generates an AGENTS.md entry pointing agents to references:

```markdown
## External References
LLM-friendly docs for key dependencies live in `docs/references/`.
Check there before searching externally or guessing APIs.
```

When agents need to use a library, they check `docs/references/` first.

## File Format

References are plain text or markdown files with a `-llms.txt` or `-llms.md` suffix. The format is whatever the source provides — ralph doesn't transform the content.

Naming convention: `<tool-or-library-name>-llms.txt`

## Acceptance Criteria

- `ralph ref add <url>` downloads the file to `docs/references/` with correct naming
- `ralph ref add <path>` copies a local file to `docs/references/`
- `ralph ref discover` scans project dependencies and finds available llms.txt files
- `ralph ref update` re-fetches all references from their original source URLs
- `ralph ref list` shows all references with sizes
- Source URL is tracked in a metadata comment so references can be updated later
- Size warnings trigger when total references exceed configured threshold
- References are plain text/markdown — no binary formats, no proprietary formats
- An agent can read any reference file directly and get useful, accurate API information
- `ralph ref remove` cleanly deletes a reference file

## Out of Scope

- Generating reference docs from source code (use existing doc generators)
- Transforming or summarizing external docs (ralph stores them as-is)
- Auto-detecting when references are stale (use `ralph ref update` periodically)
- Hosting or serving references (they're static files in the repo)
