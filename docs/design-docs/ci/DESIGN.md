# ci — Design Reference

## Purpose

CI pipeline configuration generator. Produces ready-to-use YAML (GitHub
Actions or GitLab CI) or a shell snippet (generic) that adds ralph quality
checks to an existing build workflow.

## Usage

```bash
ralph ci generate                     # Auto-detect platform
ralph ci generate --platform github   # GitHub Actions workflow
ralph ci generate --platform gitlab   # GitLab CI config
ralph ci generate --platform generic  # Shell snippet for any CI
```

## Config

No dedicated config section. Platform detection reads the filesystem:
- `.github/` directory present → GitHub Actions
- `.gitlab-ci.yml` present → GitLab CI
- Neither → generic shell snippet (printed to stdout)

## Architecture

| File | Responsibility |
|------|----------------|
| `src/commands/ci/index.ts` | `ciGenerateCommand`; three inlined template constants |

Templates (`GITHUB_ACTIONS_TEMPLATE`, `GITLAB_CI_TEMPLATE`, `GENERIC_TEMPLATE`)
are string constants in `index.ts`. There are no external template files.

Layer position: `commands/ci` → `config` (findProjectRoot), `utils/fs`,
`utils/output`. No external runtime dependencies.

## Design Decisions

**Templates are inlined constants, not external files.** Bundling templates
inside the binary avoids file-not-found errors at runtime and keeps ralph a
zero-dependency global install. Templates are readable in source without
requiring a separate lookup.

**Auto-detection before explicit flags.** The common case — a repo on one
platform — should require no flags. `--platform` is available for edge cases
(e.g., repos with both `.github/` and `.gitlab-ci.yml`, or CI environments
that don't leave the expected filesystem signals).

**Generic template outputs to stdout.** GitHub Actions and GitLab CI have
well-known file paths. Generic CI does not — printing to stdout lets the user
paste the snippet wherever their CI system expects it, without ralph guessing
an opinionated path for an unknown platform.
