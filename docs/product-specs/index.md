# Product Specifications

One topic per file. Each spec describes a single feature or concern.

| Spec | Description |
|------|-------------|
| `repo-scaffolding.md` | What `ralph init` creates and why |
| `architectural-enforcement.md` | What `ralph lint` enforces |
| `quality-grading.md` | How `ralph grade` scores projects |
| `drift-detection.md` | What `ralph gc` catches |
| `repo-diagnostics.md` | What `ralph doctor` checks |
| `execution-plans.md` | How `ralph plan` works |
| `taste-escalation.md` | The promote/escalation ladder concept |
| `references.md` | How `ralph ref` manages external docs |
| `integration.md` | Hooks and CI generation |
| `configuration.md` | Config schema and defaults |
| `v0.1.1-patch.md` | Version 0.1.1 patch spec |

## Trust Calibration (v0.6–v0.8)

| Spec | Phase | Description |
|------|-------|-------------|
| `trust-calibration-roadmap.md` | — | Overarching roadmap and ordering rationale |
| `staged-validation.md` | 1 | Multi-stage validation pipeline (unit → integration → e2e) |
| `adversarial-generation.md` | 2 | Post-pass adversarial test generation to find edge-case bugs |
| `calibration-tracking.md` | 3 | Trust drift detection via rolling calibration metrics |
| `intent-verification.md` | 4 | Spec motivation cross-referencing for intent alignment |
| `approach-divergence.md` | 5 | Temporal pattern fingerprinting and divergence flagging |

## Convention

- One spec per file — do not combine multiple features
- Use clear, descriptive filenames (e.g., `authentication.md`, `billing.md`)
- Each spec should include: Job (problem solved), Behavior (how it works), Acceptance Criteria
