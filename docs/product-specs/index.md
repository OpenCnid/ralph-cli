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

## Convention

- One spec per file — do not combine multiple features
- Use clear, descriptive filenames (e.g., `authentication.md`, `billing.md`)
- Each spec should include: Job (problem solved), Behavior (how it works), Acceptance Criteria
