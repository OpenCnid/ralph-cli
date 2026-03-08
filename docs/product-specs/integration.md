# Integration

ralph-cli provides hooks for git workflows, CI pipelines, and existing toolchains so that enforcement happens automatically, not manually.

## Job

Architectural rules and quality gates only work if they run automatically. The developer needs ralph-cli to integrate with their existing workflows — git hooks catch violations before commit, CI pipelines enforce quality gates, and existing tools (ESLint, pytest, etc.) compose with ralph rather than being replaced by it.

## How It Works

### Git Hooks

```bash
ralph hooks install
```

Installs git hooks via `.ralph/hooks/`:

**pre-commit hook:**
- Runs `ralph lint` on staged files only (fast — only checks changed files)
- Blocks commit if architectural violations are found
- Shows fix instructions inline

**post-commit hook (optional):**
- Runs `ralph grade` to update quality scores after each commit
- Non-blocking — grades are informational, not gates

**pre-push hook (optional):**
- Runs `ralph doctor --ci` to verify repo health before pushing
- Configurable threshold

```bash
ralph hooks install                    # installs pre-commit only (default)
ralph hooks install --all              # installs all hooks
ralph hooks install --hooks pre-commit,pre-push  # specific hooks
ralph hooks uninstall                  # removes all ralph hooks
```

Hooks are lightweight shell scripts that invoke `ralph` commands. They don't bundle logic — if ralph-cli isn't installed, hooks fail gracefully with a message telling the developer to install it.

### CI Templates

```bash
ralph ci generate
```

Generates CI configuration for the project's platform:

**GitHub Actions** (`.github/workflows/ralph.yml`):

```yaml
name: Ralph Quality Gates
on: [pull_request]

jobs:
  ralph:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm install -g ralph-cli
      - run: ralph lint
      - run: ralph grade --ci
      - run: ralph doctor --ci
```

**Supported CI platforms:**
- GitHub Actions (primary)
- GitLab CI
- Generic (outputs the commands to run — paste into any CI system)

```bash
ralph ci generate                      # auto-detects platform from repo
ralph ci generate --platform github    # explicit platform
ralph ci generate --platform generic   # just the commands
```

### Composing with Existing Tools

ralph-cli does NOT replace existing linters, test runners, or formatters. It adds a layer on top.

**Typical pipeline order:**

```
1. Formatter (Prettier, Black)          — style
2. Linter (ESLint, pylint)              — code quality
3. Type checker (tsc, mypy)             — type safety
4. Tests (vitest, pytest)               — correctness
5. ralph lint                           — architectural enforcement
6. ralph grade --ci                     — quality gates
7. ralph doctor --ci                    — repo health
```

ralph-cli runs AFTER existing tools. It doesn't duplicate their work. It addresses the layer above: project structure, architectural boundaries, and agent-readiness — things ESLint and pytest don't cover.

### Coverage Integration

ralph-cli reads coverage reports from existing tools to feed into `ralph grade`. Supported formats:

- lcov (vitest, jest, c8)
- Cobertura XML (pytest-cov, many others)
- Go coverage profiles

Configuration in `.ralph/config.yml`:

```yaml
quality:
  coverage:
    tool: vitest
    report-path: coverage/lcov.info
```

If no coverage tool is configured, `ralph grade` skips the test coverage dimension and grades on remaining dimensions.

## Acceptance Criteria

- `ralph hooks install` creates working git hooks that invoke ralph commands
- Hooks fail gracefully if ralph-cli is not installed (informative message, non-zero exit)
- `ralph ci generate` produces valid CI config for GitHub Actions
- Generated CI config runs `ralph lint`, `ralph grade --ci`, and `ralph doctor --ci`
- ralph-cli composes with existing tools without conflicts (no duplicate linting, no format wars)
- Coverage integration reads standard report formats without requiring changes to existing test configuration
- `ralph hooks uninstall` cleanly removes all ralph hooks without affecting other git hooks
- CI templates include caching for ralph-cli installation (fast CI runs)

## Out of Scope

- Replacing ESLint, Prettier, pytest, or any existing tool
- IDE integrations (VS Code extensions, etc.) — consider for future versions
- Deployment pipelines (ralph-cli is for development, not deployment)
- Notification systems (use CI platform's native notifications)
