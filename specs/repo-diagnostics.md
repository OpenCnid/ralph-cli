# Repo Diagnostics

`ralph doctor` evaluates a repository's readiness for AI agent development and reports what's missing, misconfigured, or suboptimal.

## Job

When a developer wants to know whether their repo is set up well for agent-driven development, they need a single command that tells them exactly what's working, what's missing, and what to fix — prioritized by impact. This applies both to repos initialized with `ralph init` and to existing repos that were never set up with agents in mind.

## How It Works

### Checks

**Structure checks:**
- Does AGENTS.md exist? Is it under 100 lines?
- Does ARCHITECTURE.md exist at root?
- Does docs/ directory exist with expected subdirectories (design-docs/, exec-plans/, product-specs/, references/, generated/)?
- Does .ralph/config.yml exist and parse correctly?
- Do domain docs exist? (DESIGN.md, RELIABILITY.md, SECURITY.md in docs/)
- Does docs/QUALITY_SCORE.md exist?
- Does docs/design-docs/core-beliefs.md exist?

**Content checks:**
- Does AGENTS.md contain build/test/lint commands?
- Does AGENTS.md reference specific LLM providers or model names? (anti-pattern)
- Is AGENTS.md a table of contents (pointers to deeper docs) or a monolith?
- Does ARCHITECTURE.md describe domain boundaries?
- Does core-beliefs.md have at least 3 beliefs/principles?
- Does exec-plans/tech-debt-tracker.md exist?

**Backpressure checks:**
- Is there a test runner configured?
- Is there a linter configured?
- Is there a type checker configured?
- Do tests actually run successfully?
- Is there a `ralph lint` configuration with at least one architectural rule?

**Operational checks:**
- Is this a git repository?
- Is there at least one commit?
- Is there a .gitignore?
- Are build artifacts excluded from git?

### Output

```
$ ralph doctor

ralph doctor — repo health check

✅ Structure
   ✓ AGENTS.md exists (67 lines)
   ✓ docs/ structure complete
   ✓ specs/ exists (4 spec files)
   ✓ .ralph/config.yml valid

⚠️  Content
   ✓ AGENTS.md has build/test/lint commands
   ✗ AGENTS.md references "Claude" on line 12 — remove LLM-specific references
   ✓ Architecture doc describes 3 domains
   ✗ docs/principles.md has only 1 principle — add at least 2 more

✅ Backpressure
   ✓ Test runner: vitest
   ✓ Linter: eslint
   ✓ Type checker: tsc
   ✓ ralph lint: 3 architectural rules configured

✅ Operational
   ✓ Git repository
   ✓ 47 commits
   ✓ .gitignore present
   ✓ Build artifacts excluded

Score: 8/10 (Good)
Fix 2 issues to reach Excellent:
  1. Remove LLM-specific references from AGENTS.md (line 12)
  2. Add 2+ principles to docs/principles.md
```

### Scoring

- **10/10 Excellent** — all checks pass
- **7-9 Good** — minor gaps that don't block agent work
- **4-6 Fair** — missing structure that will cause agent confusion
- **1-3 Poor** — fundamental issues (no AGENTS.md, no tests, no git)
- **0 Not Ready** — not a git repo or completely empty

### Behavior

- `ralph doctor` — full diagnostic with recommendations
- `ralph doctor --json` — structured output for CI
- `ralph doctor --ci` — exits non-zero if score is below a configured threshold
- `ralph doctor --fix` — runs `ralph init` for any missing structure (interactive, confirms before creating)

## Acceptance Criteria

- `ralph doctor` runs on any git repository, whether or not it was initialized with ralph
- A freshly `ralph init`'d repo scores 10/10
- Each failing check includes a specific, actionable fix recommendation
- Score accurately reflects agent-readiness (a repo scoring 3/10 is genuinely harder for agents to work in)
- `ralph doctor` completes in under 5 seconds
- `ralph doctor --fix` only creates files after user confirmation
- Checks are extensible — new checks can be added via `.ralph/rules/` or config

## Out of Scope

- Code quality assessment (see quality-grading spec)
- Architectural rule validation (see architectural-enforcement spec)
- Fixing code issues (ralph doctor diagnoses the infrastructure, not the code)
