# Execution Plans

`ralph plan` manages versioned execution plans with progress tracking and decision logging.

## Job

When complex work requires multiple agent iterations, the developer needs plans that are first-class versioned artifacts — not ephemeral notes that get lost. Plans should capture not just what needs to happen, but what was decided along the way and why, so any agent picking up the work later has full context.

## How It Works

### Plan Types

**Lightweight plans** — for small changes (1-3 tasks). Created inline, no ceremony:

```bash
ralph plan create "Add input validation to user registration"
```

Produces a minimal plan file in `docs/exec-plans/active/`:

```markdown
# Plan: Add input validation to user registration

Created: 2026-03-07
Status: active

## Tasks
- [ ] Add schema validation to registration endpoint
- [ ] Add error messages for invalid fields
- [ ] Add tests for validation edge cases
```

**Execution plans** — for complex work (4+ tasks, multi-day). Created with structure:

```bash
ralph plan create --full "Migrate auth system to OAuth2"
```

Produces a structured plan with decision log:

```markdown
# Plan: Migrate auth system to OAuth2

Created: 2026-03-07
Status: active
Estimated scope: 8-12 tasks

## Context
Why this work is happening and what success looks like.

## Tasks
- [ ] Research OAuth2 provider options
- [ ] Design token storage approach
- [ ] Implement OAuth2 flow
...

## Decisions
Decisions made during execution, logged as they happen.

## Dependencies
What this plan depends on and what depends on it.

## Risks
Known risks and mitigation strategies.
```

### Plan Lifecycle

```
active → completed
active → abandoned (with reason)
```

- `ralph plan create "title"` — creates a new lightweight plan
- `ralph plan create --full "title"` — creates a new execution plan
- `ralph plan list` — shows active plans
- `ralph plan list --all` — shows all plans including completed/abandoned
- `ralph plan complete <plan-id>` — moves plan to completed/
- `ralph plan abandon <plan-id> --reason "descoped"` — moves to completed/ with abandonment reason
- `ralph plan log <plan-id> "decision text"` — appends a decision entry with timestamp
- `ralph plan status` — summary of all active plans and their progress

### Decision Logging

The key differentiator from IMPLEMENTATION_PLAN.md. As agents work through a plan, decisions get logged:

```markdown
## Decisions

- **2026-03-07 14:23** — Chose JWT over session tokens for OAuth2 because the API is stateless and multi-region. Trade-off: token revocation is harder.
- **2026-03-08 09:15** — Abandoned custom token refresh in favor of using the provider's SDK. Reason: our implementation had edge cases the SDK handles correctly.
```

Agents are instructed (via AGENTS.md) to log decisions when they make non-obvious choices. This creates institutional memory that survives context resets.

### Versioning

All plans live in `docs/exec-plans/`. They are committed to git like any other artifact. The plan's git history IS its version history — no separate versioning system needed.

```
docs/exec-plans/
├── active/
│   ├── 001-add-validation.md
│   └── 002-migrate-oauth2.md
├── completed/
│   ├── 000-initial-scaffold.md
│   └── ...
├── tech-debt-tracker.md  # Known technical debt, prioritized
└── index.md              # Auto-generated catalog
```

### Tech Debt Tracking

`docs/exec-plans/tech-debt-tracker.md` is a living document that captures known technical debt with priority and context. Agents log debt as they discover it during implementation. Developers review and promote high-priority debt items into execution plans.

```markdown
## Known Technical Debt

| ID | Description | Priority | Discovered | Plan |
|----|-------------|----------|------------|------|
| TD-001 | Payment handler uses string comparison for amounts | High | 2026-03-05 | — |
| TD-002 | Auth tokens stored in localStorage | Medium | 2026-03-07 | 003-auth-migration |
```

## Acceptance Criteria

- `ralph plan create` produces a valid plan file in the correct directory
- `ralph plan list` shows all active plans with completion percentage (based on checkbox count)
- `ralph plan complete` moves the file and updates index.md
- `ralph plan log` appends a timestamped decision entry to the correct plan
- Plans are plain markdown — readable and editable by any agent or human
- `ralph plan status` gives a useful summary without reading each plan file
- Decision log entries survive across agent context resets (they're on disk)
- index.md is automatically kept in sync when plans are created, completed, or abandoned

## Relationship to IMPLEMENTATION_PLAN.md

ralph-cli plans are a superset of the Ralph Loop's IMPLEMENTATION_PLAN.md. During a Ralph Loop build session, the loop still uses IMPLEMENTATION_PLAN.md as shared state. But the broader project context — why decisions were made, what was tried and abandoned, cross-cutting concerns — lives in ralph-cli's plan system.

They can coexist: IMPLEMENTATION_PLAN.md is the agent's working memory during a loop. `docs/plans/` is the project's institutional memory across loops.

## Out of Scope

- Project management features (assignees, due dates, priorities beyond ordering)
- Integration with external PM tools (Jira, Linear, etc.)
- Automated plan generation from specs (that's the Ralph Loop planning phase)
- Dependency resolution between plans
