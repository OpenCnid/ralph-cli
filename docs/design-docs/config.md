# Config Domain

## Purpose

The `config` domain loads and validates `.ralph/config.yml`, merges user
settings with defaults, and exposes a fully-typed `RalphConfig` to every
command. It is the foundational layer that all other commands depend on.

## Usage

```bash
# Validate the config file
ralph config validate

# From TypeScript (internal)
import { loadConfig } from './config/loader.js';
const config = await loadConfig();
```

## Config

`.ralph/config.yml` — the file this domain reads. Relevant sections:

```yaml
project:
  name: my-project
  language: typescript

architecture:
  layers: [config, utils, commands, cli]
  direction: forward-only
  domains:
    - name: lint
      path: src/commands/lint
  rules:
    max-lines: 500
    naming:
      schemas: "*Schema"
      types: "*Type"

quality:
  minimum-grade: C
  coverage:
    tool: vitest
    report-path: coverage/lcov.info
```

## Architecture

```
src/config/
  schema.ts    — All TypeScript interfaces (RalphConfig, RunConfig, …)
  defaults.ts  — Default values for every field
  loader.ts    — loadConfig(), mergeWithDefaults()
  validate.ts  — validateConfig(), KNOWN_TOP_KEYS
```

Layer: **config** (bottom). Imported by all commands; imports nothing from
`src/commands/` or `src/utils/`.

## Design Decisions

**Validate before merge.** `validateConfig()` runs on the raw YAML so user
mistakes (wrong types, unknown keys) are caught before defaults fill gaps.

**Typed defaults.** `DEFAULT_CONFIG` mirrors every field in `RalphConfig`.
Commands receive a complete object and never need defensive null checks on
standard config fields.

**`exactOptionalPropertyTypes`.** Optional fields carry `| undefined` in their
type so accidental access of missing fields fails at compile time, not runtime.
