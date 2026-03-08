# Architectural Enforcement

`ralph lint` validates structural rules and produces agent-readable error messages with remediation instructions.

## Job

When AI agents continuously generate code, architectural drift is inevitable — agents replicate patterns they find, including bad ones. The developer needs mechanical enforcement of structural rules so that boundaries hold without human review of every change.

## How It Works

### Rule Types

**Dependency direction rules** — Define which modules/domains can depend on which others. Violations produce errors like:

```
ERROR: domain/billing/service.ts imports from domain/auth/ui.ts
  Rule: Services cannot depend on UI layers.
  Fix: Move the shared type to domain/auth/types.ts and import from there.
```

**File organization rules** — Enforce where files belong based on naming patterns or content:

```
ERROR: src/utils/handlePayment.ts contains business logic
  Rule: utils/ is for generic utilities, not domain logic.
  Fix: Move to domain/billing/service/ or create a new domain module.
```

**Naming convention rules** — Enforce consistent naming for schemas, types, exports:

```
ERROR: UserData in models/user.ts does not follow schema naming convention
  Rule: Schema types must be suffixed with 'Schema' (e.g., UserSchema).
  Fix: Rename UserData to UserSchema or UserDataSchema.
```

**File size limits** — Flag files that exceed a configured threshold:

```
WARNING: src/api/routes.ts is 847 lines (limit: 500)
  Rule: Files over 500 lines indicate missing decomposition.
  Fix: Split into domain-specific route files under src/api/routes/.
```

**Custom rules** — Defined in `.ralph/rules/` as declarative YAML or as scripts that output structured results.

### Error Message Format

Every lint error MUST include:
1. **What** — the violation found
2. **Rule** — which principle or rule it violates
3. **Fix** — concrete remediation steps an agent can follow

This is the key differentiator from traditional linters. The error messages are written for agents, not humans. They should be specific enough that an agent reading the error can fix the problem without additional context.

### Rule Definition

Rules are defined in `.ralph/config.yml` under an `architecture` section:

```yaml
architecture:
  layers:
    - types
    - config
    - repo
    - service
    - runtime
    - ui
  direction: forward-only  # each layer can only import from layers above it
  
  domains:
    - name: billing
      path: src/domain/billing
    - name: auth
      path: src/domain/auth
  
  cross-cutting:
    - auth
    - telemetry
    - feature-flags
  
  rules:
    max-file-lines: 500
    naming:
      schemas: "*Schema"
      types: "*Type"
    custom:
      - .ralph/rules/no-yolo-data-access.yml
```

### Running

- `ralph lint` — runs all configured rules, exits non-zero on errors
- `ralph lint --fix` — where possible, auto-fixes violations (e.g., renames, moves imports)
- `ralph lint --json` — outputs structured JSON for CI consumption
- `ralph lint path/to/file.ts` — lint a specific file or directory
- `ralph lint --rule dependency-direction` — run a specific rule only

## Acceptance Criteria

- `ralph lint` detects dependency direction violations in a project with configured layer rules
- Every error message includes what, rule, and fix fields
- An AI agent given the error output can resolve the violation without additional context
- `ralph lint` exits 0 when no violations found, non-zero otherwise
- Custom rules in `.ralph/rules/` are discovered and executed automatically
- `ralph lint` works on TypeScript, JavaScript, and Python projects (language support is extensible)
- Running time is under 10 seconds for a 10,000-file repository
- Rules are defined declaratively — no programming required for standard patterns

## Out of Scope

- Code style (formatting, whitespace) — use Prettier, Black, etc.
- Type checking — use tsc, mypy, etc.
- Security scanning — use dedicated security tools
- Test coverage — use existing coverage tools
- ralph-cli composes with these tools, it doesn't replace them
