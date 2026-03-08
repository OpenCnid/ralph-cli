# Implementation Plan — ralph-cli

## Current State

- **Version**: 0.1.1
- **Commands**: All 10 implemented (init, lint, grade, gc, doctor, plan, promote, ref, hooks, ci) + config validate
- **Tests**: 312 across 14 files — all passing
- **Dependencies**: Runtime: `commander`, `yaml`, `picocolors`. Dev: `typescript`, `vitest`, `eslint`, `@types/node`

## Release History

| Version | Date | Summary |
|---------|------|---------|
| 0.1.1 | 2026-03-08 | Interactive init/doctor/ref, prompt utils, grade crash fix, GC orphan fix, custom YAML autofix, README + AGENTS.md |
| 0.0.28–0.0.32 | 2026-03-07 | GC git context, config schema rename (`files`→`rules`), direction field, script rules, trend reasons, spec alignment |
| 0.0.23–0.0.27 | 2026-03-06 | Doctor spec compliance, CI auto-detection, GC dedup + temporal context, Python/Go linter detection, per-dimension trends |
| 0.0.16–0.0.22 | 2026-03-04–05 | Lint --fix autofix, ref discover, pre-commit staged files, promote violation counts + escalation path, plan contextual tasks |
| 0.0.10–0.0.15 | 2026-03-03–04 | File-organization rule, GC dead code + principle violations, per-domain grading, promote format, GC category filter |
| 0.0.5–0.0.9 | 2026-03-02–03 | Staleness dimension, multi-format coverage, config validation, domain isolation, doctor enhancements |
| 0.0.1–0.0.4 | 2026-03-01 | Foundation, all 10 commands (P0–P9) |

Full details → `CHANGELOG.md`

## Command Implementation Status

| Command | Status | Tests |
|---------|--------|-------|
| `ralph init` | ✅ Complete (interactive + --defaults) | 15+ |
| `ralph lint` | ✅ Complete (5 built-in rules + custom YAML/JS + --fix) | 32+ |
| `ralph grade` | ✅ Complete (5 dimensions, per-domain, trends) | 36+ |
| `ralph gc` | ✅ Complete (4 categories, dedup, trends, custom anti-patterns) | 22+ |
| `ralph doctor` | ✅ Complete (structure/content/backpressure/ops, --fix) | 16+ |
| `ralph plan` | ✅ Complete (create/status/complete/abandon/list, --json) | 10+ |
| `ralph promote` | ✅ Complete (doc/lint/pattern/list, escalation tracking) | 5+ |
| `ralph ref` | ✅ Complete (add/update/list/discover, -llms.md/.txt) | 4+ |
| `ralph hooks` | ✅ Complete (pre-commit on staged files) | 4+ |
| `ralph ci` | ✅ Complete (GitHub Actions + GitLab CI, caching) | 5+ |
| `config validate` | ✅ Complete (all sections, nested keys, type checks) | 27+ |

## Deferred Items

- **Lint --fix for structural rules** — Autofix infrastructure in place (naming-convention + custom YAML `autofix.replace`). File-size, dependency-direction, domain-isolation, file-organization report only — auto-fix not feasible without human judgment.

## Notes

- **LLM-agnostic**: Zero references to specific AI providers or models anywhere. Hard constraint.
- **ESM only**: `import` statements, never `require()`. `.ts` imports resolve to `.js` in output.
- **`exactOptionalPropertyTypes`**: Optional props need `| undefined`.
- **YAML 1.2**: Single-quote regex patterns with backslashes in `.yml` files.
- **Test isolation**: Tests `chdir()` to temp dirs with `.git/` stubs. Restore `origCwd` in `afterEach`.
