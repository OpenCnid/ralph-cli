# ralph-cli — Detailed Agent Reference

Extended reference for AGENTS.md. See AGENTS.md for the concise entry point.

## Project Structure

```
src/
├── cli.ts                          — Entry point, commander router
├── config/                         — Config system
│   ├── schema.ts                   — TypeScript types for .ralph/config.yml
│   ├── loader.ts                   — Find, parse, merge config (walks up dirs)
│   ├── validate.ts                 — Validation orchestrator
│   ├── validators.ts               — Domain-specific validators (project, arch, gc, etc.)
│   ├── validate-run.ts             — Run-domain validators (run, stages, adversarial)
│   └── defaults.ts                 — Default config values
├── utils/                          — Shared utilities (fs, output, prompt)
└── commands/
    ├── run/                        — Autonomous build loop
    │   ├── index.ts                — Loop orchestration
    │   ├── agent.ts                — Agent spawn, timeout, presets
    │   ├── prompts.ts              — Template engine (plan/build/adversarial)
    │   ├── detect.ts               — Auto-detect test/typecheck commands
    │   ├── stages.ts               — Multi-stage validation pipeline
    │   ├── validation.ts           — Validation orchestrator (delegates to stages)
    │   ├── adversarial.ts          — Adversarial pass (file restriction, test guard, diagnostic branch)
    │   ├── scoring.ts              — Score context builder (stage-aware, adversarial-aware)
    │   ├── git.ts                  — Git helpers (revert to baseline)
    │   ├── progress.ts             — Checkpoint I/O, banners, calibration summary
    │   ├── lock.ts                 — Run lock management
    │   ├── timeout.ts              — Agent timeout wrapper
    │   └── types.ts                — RunMode, RunOptions, AdversarialResult types
    ├── score/                      — Fitness scoring
    │   ├── index.ts                — CLI entry point (--calibration, --history, --trend)
    │   ├── scorer.ts               — Score script discovery and execution
    │   ├── default-scorer.ts       — Built-in test+coverage scorer
    │   ├── calibration.ts          — Trust drift detection (pass rate, volatility, signals)
    │   ├── results.ts              — TSV results log (9-column, stages + adversarial-fail)
    │   ├── trend.ts                — Trend computation and sparkline
    │   └── types.ts                — ScoreResult, ResultEntry, ScoreContext
    ├── review/                     — Agent-powered code review
    │   ├── index.ts                — reviewCommand entry point
    │   ├── context.ts              — Diff extraction, context assembly, extractMotivation()
    │   ├── prompts.ts              — Review + intent review prompt templates
    │   └── types.ts                — ReviewOptions, ReviewContext
    ├── heal/                       — Automated self-repair
    ├── gc/                         — Drift detection
    │   ├── index.ts                — gcCommand (--temporal, --json)
    │   ├── scanners.ts             — 4-category drift scanners + collectPatternData()
    │   ├── fingerprint.ts          — Temporal pattern fingerprinting + divergence detection
    │   └── history.ts              — Drift history tracking
    ├── lint/                       — Architectural enforcement
    ├── grade/                      — Quality grading (5 dimensions, trends)
    ├── doctor/                     — Repo diagnostics (motivation check included)
    ├── init/                       — Repo scaffolding
    ├── plan/                       — Execution plan management
    ├── promote/                    — Taste escalation ladder
    ├── ref/                        — Reference management
    ├── hooks/                      — Git hooks
    ├── ci/                         — CI config generation
    └── config-validate.ts          — Standalone config validation command
```

## Trust Calibration Features (v0.6)

Five features that shift ralph from failure catching to trust calibration:

1. **Staged Validation** — Multi-stage pipeline (unit → typecheck → integration → e2e) with dependency chains, timeouts, and stage-aware error feedback. Config: `run.validation.stages[]`.

2. **Adversarial Generation** — After each passing build iteration, a second agent writes edge-case tests to break the implementation. File restriction + test deletion guard enforced mechanically. Failing tests pushed to diagnostic branch before revert. Config: `run.adversarial`.

3. **Calibration Tracking** — Rolling metrics (pass rate, discard rate, score volatility) with trust drift detection. Fires when pass rate is suspiciously high with zero discards. CLI: `ralph score --calibration`.

4. **Intent Verification** — `ralph review --intent` cross-references code against spec `## Motivation` sections. `ralph doctor` checks that specs include motivation sections.

5. **Approach Divergence** — `ralph gc --temporal` tracks how coding patterns evolve across iterations. Detects new-pattern, dominant-shift, and proportion-change divergences.

## Documentation Index

| Document | Purpose |
|----------|---------|
| `ARCHITECTURE.md` | Domain boundaries, layers, dependency rules, cross-command exceptions |
| `docs/product-specs/trust-calibration-roadmap.md` | 5-phase trust calibration roadmap |
| `docs/product-specs/staged-validation.md` | Staged validation pipeline spec |
| `docs/product-specs/adversarial-generation.md` | Adversarial testing spec |
| `docs/product-specs/calibration-tracking.md` | Trust drift detection spec |
| `docs/product-specs/intent-verification.md` | Intent review spec |
| `docs/product-specs/approach-divergence.md` | Pattern fingerprinting spec |
| `docs/product-specs/ralph-run.md` | Autonomous build loop spec |
| `docs/product-specs/fitness-scoring.md` | Fitness scoring spec |
| `docs/product-specs/ralph-review.md` | Code review spec |
| `docs/product-specs/ralph-heal.md` | Self-repair spec |
| `docs/product-specs/configuration.md` | Config schema and defaults |
| `docs/product-specs/repo-scaffolding.md` | What `ralph init` creates |
| `docs/product-specs/architectural-enforcement.md` | What `ralph lint` enforces |
| `docs/product-specs/quality-grading.md` | How `ralph grade` scores projects |
| `docs/product-specs/drift-detection.md` | What `ralph gc` catches |
| `docs/product-specs/repo-diagnostics.md` | What `ralph doctor` checks |
| `docs/product-specs/taste-escalation.md` | The promote/escalation ladder |
