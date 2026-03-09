# lint — Design Reference

## Purpose

Architectural lint engine for ralph-cli. Runs configurable rules against source
files and reports violations. Supports auto-fix for safe transformations.

## Usage

```bash
ralph lint [path] [--fix] [--rule <name>] [--json]
```

## Config

```yaml
architecture:
  rules:
    max-lines: 300
    naming:
      schemas: [{pattern: '^[a-z]', targets: [file]}]
    direction: forward-only
  layers: [config, commands, utils]
  domains: [{name: x, path: src/x}]
  cross-cutting: [utils]
```

Custom rules in `.ralph/rules/*.yml` or `.ralph/rules/*.js`.

## Architecture

| File | Role |
|------|------|
| `index.ts` | Entry point — wires config, rules, files, output |
| `engine.ts` | `runRules()`, `LintRule` interface, violation + JSON formatters |
| `files.ts` | `collectFiles()` — glob-based file discovery with excludes |
| `imports.ts` | Static import parser for dependency graph rules |
| `rules/dependency-direction.ts` | Layer ordering enforcement |
| `rules/domain-isolation.ts` | Cross-domain import prevention |
| `rules/file-size.ts` | Max-lines threshold check |
| `rules/naming-convention.ts` | File name regex validation + autofix |
| `rules/file-organization.ts` | Domain directory membership check |
| `rules/custom-rules.ts` | YAML + JS custom rule loader |

## Design Decisions

**Engine is rule-agnostic.** `engine.ts` knows nothing about what rules check. It
receives a `LintRule[]` and calls each rule's `check()`. Adding a new rule requires
no changes to the engine — only a new factory function and a registration line in
`index.ts`.

**Autofix is a separate optional method.** The `LintRule` interface has an optional
`autofix(context): LintFixResult[]` method. Rules that cannot safely fix violations
simply omit it. The CLI applies all available fixes before running a final check pass,
so the reported violations are always post-fix state.

**grade reuses lint internals.** `scorers.ts` in the `grade` domain imports rule
factories and `runRules` directly to score architectural health per domain. This
ensures lint and grade enforce the same rules from the same config, with no
duplication.
