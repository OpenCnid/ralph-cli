# Config — Design

## Purpose

Loads, validates, and merges `.ralph/config.yml` with defaults. Provides a
typed `RalphConfig` object that all commands consume. This is the single source
of truth for every configurable behaviour in ralph-cli.

## Usage

```typescript
import { loadConfig } from '../../config/loader.js';

const config = await loadConfig();  // throws on validation error
console.log(config.project.name);
```

## Config

The config module reads `.ralph/config.yml`. All fields are optional — missing
fields are filled from `defaults.ts`. The file must be valid YAML.

## Architecture

```
src/config/
  schema.ts    — TypeScript interfaces for RalphConfig and all sub-types
  defaults.ts  — DEFAULT_CONFIG and DEFAULT_RUN constants
  loader.ts    — loadConfig(), mergeWithDefaults()
  validate.ts  — validateConfig() — reports errors and warnings
```

`loadConfig()` call sequence:
1. Read `.ralph/config.yml` (YAML parse)
2. `validateConfig()` — collect errors / warnings
3. `mergeWithDefaults()` — fill missing fields
4. Return typed `RalphConfig`

Layer position: **config** (bottom layer). No imports from `commands/` or `utils/`.

## Design Decisions

**Merge-then-validate vs validate-then-merge.** Validation runs on the raw YAML
before merging with defaults. This catches typos in user-supplied values (e.g.,
negative `max-lines`) before defaults could silently paper over them.

**All fields have defaults.** Commands never need to null-check config fields
(except `run`, which is populated lazily). This eliminates a whole class of
runtime errors and keeps command code clean.

**Single YAML file.** One `.ralph/config.yml` rather than per-command config
files keeps the configuration surface small and easy to audit.
