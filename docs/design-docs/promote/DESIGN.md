# promote — Detailed Design

## Subcommand Reference

| Subcommand | Output | Location |
|------------|--------|----------|
| `promote doc` | Appended bullet entry | `design-docs/core-beliefs.md` |
| `promote lint` | YAML rule file | `.ralph/rules/<name>.yml` |
| `promote pattern` | Markdown template | `design-docs/patterns/<name>.md` |
| `promote list` | Console table | stdout |

## Entry Format

Doc entries follow the spec-compliant format:
```
- **principle text.** Added YYYY-MM-DD.
```

Trailing periods in the principle text are stripped before wrapping in bold to
avoid double-period output.

## Lint Rule Schema

Generated YAML rules:
```yaml
name: rule-name
description: Human-readable description
severity: error
promoted-from: <optional source>
match:
  pattern: 'regex pattern'
  require-nearby: 'optional nearby pattern'
  within-lines: 5
fix: Actionable fix message
```

## Pattern Document Template

```markdown
# Pattern Name

Created: YYYY-MM-DD
Status: Draft

## Description
## When to Use
## Examples
## Trade-offs
```

## Violation Tracking

`promote list` calls `countCustomRuleViolations()` which:
1. Loads custom YAML rules from `.ralph/rules/`
2. Runs `collectFiles()` to gather project source files
3. Executes `runRules()` from the lint engine
4. Returns a `Map<ruleName, count>` for display

## Design Decisions

**Pattern files update `design-docs/index.md` automatically.** When an
`index.md` exists, `promote pattern` inserts a table row before the
`## Adding` section. This keeps the index in sync without requiring manual
maintenance.

**`promoted-from` field preserves audit trail.** When using `--from`, the
source field is stored in the generated YAML. This enables tracking which
informal discussions or PR comments led to enforcement, giving context to
future maintainers who wonder why a rule exists.
