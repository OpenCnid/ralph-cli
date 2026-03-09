# ci — Design

## Purpose

`ralph ci` generates CI pipeline configuration that integrates ralph quality
checks (lint, grade, doctor) into existing build workflows. It auto-detects
the CI platform and produces ready-to-use YAML or shell snippets.

## Usage

```bash
ralph ci generate                     # Auto-detect platform, generate config
ralph ci generate --platform github   # Force GitHub Actions output
ralph ci generate --platform gitlab   # Force GitLab CI output
ralph ci generate --platform generic  # Print shell snippet for any CI
```

## Config

No dedicated config section. Detection uses filesystem signals:
- `.github/` directory → GitHub Actions
- `.gitlab-ci.yml` → GitLab CI
- Neither → generic snippet

## Architecture

```
src/commands/ci/
  index.ts  — ciGenerateCommand; GITHUB_ACTIONS_TEMPLATE, GITLAB_CI_TEMPLATE,
               GENERIC_TEMPLATE constants
```

Layer position: `commands/ci` → `config/findProjectRoot`, `utils/fs`,
`utils/output`. All templates are inlined string constants. No external deps.

## Design Decisions

**Templates are inlined string constants, not external files.** Keeping
templates in source eliminates file loading at runtime and makes ralph a
zero-dependency install from the user's perspective. Template content is
readable directly in source without requiring a separate docs lookup.

**Auto-detection before explicit flags.** When `--platform` is omitted, ralph
checks for `.github/` then `.gitlab-ci.yml`. This makes the common case
(single-platform repos) zero-configuration, while `--platform` remains for
CI environments that do not leave the expected filesystem signals.

**Generic template outputs to stdout, not a file.** GitHub and GitLab have
well-known file locations (`.github/workflows/ralph.yml`, `.ralph-ci.gitlab-ci.yml`).
Generic CI does not — printing the snippet to stdout lets the user decide
where to paste it, avoiding an opinionated file path for an unknown platform.
