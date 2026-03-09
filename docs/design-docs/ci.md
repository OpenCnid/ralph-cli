# ci — Domain Overview

## Purpose

`ralph ci` generates CI pipeline configuration that adds ralph quality checks
to a project's existing build workflow. It supports GitHub Actions and GitLab
CI with platform auto-detection, and prints a generic shell snippet for any
other CI system.

## Usage

```bash
ralph ci generate                      # Auto-detect platform
ralph ci generate --platform github    # GitHub Actions workflow
ralph ci generate --platform gitlab    # GitLab CI config
ralph ci generate --platform generic   # Shell snippet for any CI
```

## Config

No dedicated config section. Platform detection is filesystem-based:
- `.github/` exists → GitHub Actions
- `.gitlab-ci.yml` exists → GitLab CI
- Neither → generic

## Architecture

```
src/commands/ci/
  index.ts  — ciGenerateCommand with three embedded templates as string constants
```

Layer position: minimal. Only deps: `config/findProjectRoot`, `utils/fs`,
`utils/output`. Output files are written via `safeWriteFile`.

## Design Decisions

**Quality steps run after tests, not instead of them.** Generated pipelines
run `ralph lint`, `ralph grade --ci`, `ralph doctor --ci` as dedicated steps
following the existing build and test steps. This keeps ralph checks clearly
separated from build failures, making it easy to triage which category of
failure occurred.

**Caching ralph-cli reduces CI time.** The GitHub Actions template caches the
npm global install path keyed on `package-lock.json`. For projects that run
CI many times per day, this avoids repeated `npm install -g ralph-cli`
downloads.

**Separate file vs. snippet for different platforms.** GitHub Actions and
GitLab CI have standard locations where workflow files must live. The generic
template prints to stdout because there is no standard location — the user
knows their CI system better than ralph does.
