# Config — Detailed Design

## Purpose

Loads, validates, and merges `.ralph/config.yml` with defaults. Provides the
typed `RalphConfig` object used by every ralph-cli command.

## Usage

```typescript
import { loadConfig } from '../../../config/loader.js';
const config = await loadConfig();   // validated + defaults applied
```

## Config

This module reads its own config — `.ralph/config.yml`. There is no external
config for the config domain itself. All sections documented in `config.md`.

## Architecture

### Files

| File | Responsibility |
|------|----------------|
| `schema.ts` | TypeScript interfaces for every config section |
| `defaults.ts` | `DEFAULT_CONFIG`, `DEFAULT_RUN`, `DEFAULT_AGENT` constants |
| `loader.ts` | `loadConfig()`, `mergeWithDefaults()`, YAML parsing |
| `validate.ts` | `validateConfig()` — errors and warnings for all fields |

### Call flow

```
loadConfig()
  ├─ readFileSync(.ralph/config.yml)
  ├─ YAML.parse()
  ├─ validateConfig()  → collect errors / warnings
  └─ mergeWithDefaults() → RalphConfig (fully populated)
```

Layer position: **config** (bottom layer). No imports from `commands/` or `utils/`.

## Design Decisions

**Merge after validate.** The raw YAML is validated before defaults are applied.
This catches typos and wrong types in user-provided values rather than silently
accepting them.

**Partial raw types.** `RawRalphConfig` uses `Partial<…>` for every section so
the YAML parser can return a half-populated object without TypeScript errors.
`mergeWithDefaults()` turns this into the fully-typed `RalphConfig`.

**Single config file.** One `.ralph/config.yml` keeps the configuration surface
auditable at a glance. Per-command config files would fragment visibility.
