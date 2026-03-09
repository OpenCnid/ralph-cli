# Spec: Dogfood Cleanup — v0.2.1

**Version:** 0.2.1
**Status:** Active
**Date:** 2026-03-09

---

## Overview

ralph-cli scores 10/10 on `ralph doctor` but gets F grades on docs across every domain and has 5 drift items in `ralph gc`. This spec fixes both: add per-domain documentation and resolve all GC drift items. This is also the first real-world test of `ralph run`.

**One sentence:** Make ralph-cli pass its own quality bar — every domain graded B or above, zero persistent GC drift.

---

## Jobs To Be Done

1. **As a contributor (human or agent), I need per-domain documentation** so I understand each command's purpose, API, and design decisions without reading source code.

2. **As a project maintainer, I want zero persistent GC drift** so the codebase stays clean and the quality score reflects reality.

---

## Task 1: Per-Domain Documentation

Every domain in ralph-cli needs three documentation files to pass `ralph grade` docs checks:

For each domain (`config`, `init`, `lint`, `grade`, `gc`, `doctor`, `plan`, `promote`, `ref`, `hooks`, `ci`, `run`):

Create `docs/{domain}/README.md` with:
- **Purpose** — What the command does (1-2 sentences)
- **Usage** — CLI invocation examples
- **Config** — Relevant `.ralph/config.yml` sections
- **Architecture** — Key files, layer position, imports
- **Design Decisions** — Why it works the way it does (at least 2 decisions)

These are the "domain documentation files" that `ralph grade` checks for in the `Docs` dimension.

### Acceptance Criteria
- `ralph grade` docs dimension is A or B for every domain
- Each README.md is 30-100 lines (concise, not padding)
- No LLM provider references in any doc

---

## Task 2: Resolve GC Drift Items

Current `ralph gc` reports 5 items:

### 2a: Deep optional chaining in loader.ts
`src/config/loader.ts` lines 78-79 use `architecture?.rules?.naming?.schemas` — deep probing of unvalidated data.

**Fix:** The data IS validated by `validate()` before `mergeWithDefaults()` is called in `loadConfig()`. The optional chaining is defensive but the principle violation is a false positive in this context. Add a code comment explaining why the chaining is acceptable here (data is validated upstream). If `ralph gc` still flags it, add it to GC exclude patterns.

### 2b: console.log in output.ts
`src/utils/output.ts` uses `console.log` — but this IS the output module. All other files are supposed to call these functions instead of raw `console.log`.

**Fix:** This is a false positive. `output.ts` is the structured output layer — it wraps `console.log` intentionally. Add a `// ralph-gc-ignore: output utilities are the logging boundary` comment or add the file to GC exclude.

### 2c: vitest.config.ts "dead code"
Not imported by any file because it's a config file loaded by vitest directly.

**Fix:** False positive. Add `vitest.config.ts` to GC exclude list in `.ralph/config.yml`.

### 2d-2e: Pattern inconsistency (null checking)
Some files use `=== null` / `!== null` while the dominant pattern is nullish coalescing (`??`).

**Fix:** Migrate the 8-9 files using explicit null checks to nullish coalescing where safe. Some null checks may be intentional (distinguishing `null` from `undefined` with `exactOptionalPropertyTypes`) — leave those with a comment.

### Acceptance Criteria
- `ralph gc` reports 0 items (or only items with documented justification)
- No regressions in existing tests
- All changes are minimal and focused (no unrelated refactoring)

---

## Task 3: Version Bump + CHANGELOG

- Bump `package.json` version to `0.2.1`
- Add v0.2.1 section to CHANGELOG.md
- Update IMPLEMENTATION_PLAN.md current state

### Acceptance Criteria
- `ralph --version` shows `0.2.1`
- CHANGELOG.md has a v0.2.1 entry

---

## Non-Goals

- New features (this is cleanup only)
- Changing ralph's grading algorithm
- Adding new lint rules
- Modifying test coverage thresholds

---

## Validation

After all tasks:
```
npm test && npx tsc --noEmit && ralph doctor --ci && ralph grade --ci
```

All tests pass. Doctor 10/10. Every domain B or above on grade.
