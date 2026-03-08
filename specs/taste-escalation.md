# Taste Escalation

`ralph promote` turns human review feedback into progressively stronger enforcement — from documentation to lint rules to code patterns.

## Job

When a developer reviews agent-generated code and spots a pattern they don't like, they need a way to encode that preference once and have it enforced everywhere going forward. Without this, the same feedback gets given repeatedly on every PR, wasting the developer's scarce attention.

## The Escalation Ladder

OpenAI discovered that taste enforcement follows a natural escalation:

```
Review comment → Documentation → Lint rule → Code pattern
   (weakest)                                    (strongest)
```

Each level is more enforceable but also more rigid:

1. **Review comment** — "Don't do this." Ephemeral. Agent might not see it next time.
2. **Documentation** — Written in core-beliefs.md, a domain doc (RELIABILITY.md, SECURITY.md), or a design doc. Agent can discover it, but might not.
3. **Lint rule** — `ralph lint` catches it mechanically. Agent MUST fix it to pass CI.
4. **Code pattern** — A shared utility or abstraction that makes the wrong thing impossible. Strongest enforcement.

Most feedback starts at level 1. `ralph promote` helps move it up the ladder.

## How It Works

### Promoting to Documentation

```bash
ralph promote doc "Always validate API responses with schema validation, never access fields directly"
```

Appends to `docs/design-docs/core-beliefs.md` by default:

```markdown
- **Validate API responses with schema validation.** Never access response fields directly without validation. Added 2026-03-07.
```

Can target a specific domain doc:

```bash
ralph promote doc --to security "All user input must be sanitized before database queries"
# Appends to docs/SECURITY.md
```

### Promoting to Lint Rule

```bash
ralph promote lint "no-unvalidated-api-access" \
  --description "API responses must be validated before field access" \
  --pattern "fetch|axios|got" \
  --require "schema|validate|parse" \
  --fix "Wrap the API call result in a schema validation function before accessing fields"
```

Creates `.ralph/rules/no-unvalidated-api-access.yml`:

```yaml
name: no-unvalidated-api-access
description: API responses must be validated before field access
severity: error
match:
  pattern: "fetch|axios|got"
  require-nearby: "schema|validate|parse"
  within-lines: 5
fix: "Wrap the API call result in a schema validation function before accessing fields"
```

This rule is automatically picked up by `ralph lint`.

### Promoting to Code Pattern

```bash
ralph promote pattern "validated-api-call" \
  --description "A wrapper that validates API responses at the boundary"
```

Creates a placeholder in `docs/design/patterns/validated-api-call.md` describing the desired pattern, with a task for the agent to implement the actual utility. This is a prompt for the next agent iteration, not auto-generated code.

### Listing Active Promotions

```bash
ralph promote list
```

Shows all taste rules and their current enforcement level:

```
Taste Rules:
  ✓ validate-api-responses    lint   (.ralph/rules/no-unvalidated-api-access.yml)
  ✓ result-type-errors        doc    (docs/principles.md, line 14)
  ✓ shared-utils-over-helpers doc    (docs/principles.md, line 8)
  ○ structured-logging        lint   (.ralph/rules/structured-logging.yml) — 12 violations remaining
```

## Acceptance Criteria

- `ralph promote doc` appends a new principle to docs/principles.md with timestamp
- `ralph promote lint` creates a valid rule file that `ralph lint` discovers and enforces
- `ralph promote pattern` creates a design doc describing the desired pattern
- `ralph promote list` shows all taste rules across all enforcement levels
- Promotion is additive — promoting to lint doesn't remove the doc-level principle
- Rules created by `ralph promote lint` include agent-readable fix instructions
- The full escalation path is tracked: if a rule started as a doc and was promoted to lint, both are visible

## Out of Scope

- Auto-generating code patterns (the developer or agent writes the actual implementation)
- Parsing PR review comments automatically (input is manual — the developer decides what to promote)
- Rolling back promotions (delete the file manually if a rule was wrong)
- Cross-repo taste sharing (each repo has its own rules)
