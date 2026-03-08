import { existsSync, readFileSync, chmodSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { findProjectRoot } from '../../config/index.js';
import { ensureDir, safeWriteFile } from '../../utils/fs.js';
import { success, warn, error, info } from '../../utils/index.js';

const HOOK_SCRIPTS: Record<string, string> = {
  'pre-commit': `#!/bin/sh
# ralph-cli pre-commit hook
# Lint staged files only, block on violations

if ! command -v ralph >/dev/null 2>&1; then
  echo "ralph-cli not found. Install with: npm install -g ralph-cli"
  echo "Skipping pre-commit checks."
  exit 0
fi

# Skip if no staged source files
STAGED=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\\.(ts|tsx|js|jsx|py|go|rs)$' || true)
if [ -z "$STAGED" ]; then
  exit 0
fi

ralph lint
`,

  'post-commit': `#!/bin/sh
# ralph-cli post-commit hook
# Run grade (informational, non-blocking)

if ! command -v ralph >/dev/null 2>&1; then
  exit 0
fi

ralph grade 2>/dev/null || true
`,

  'pre-push': `#!/bin/sh
# ralph-cli pre-push hook
# Run doctor in CI mode

if ! command -v ralph >/dev/null 2>&1; then
  echo "ralph-cli not found. Install with: npm install -g ralph-cli"
  echo "Skipping pre-push checks."
  exit 0
fi

ralph doctor --ci
`,
};

export function hooksInstallCommand(options: { all?: boolean; hooks?: string }): void {
  const projectRoot = findProjectRoot(process.cwd());
  const gitHooksDir = join(projectRoot, '.git', 'hooks');
  const ralphHooksDir = join(projectRoot, '.ralph', 'hooks');

  if (!existsSync(join(projectRoot, '.git'))) {
    error('Not a git repository. Run `git init` first.');
    process.exit(1);
  }

  ensureDir(gitHooksDir);
  ensureDir(ralphHooksDir);

  let hooksToInstall: string[];
  if (options.all) {
    hooksToInstall = Object.keys(HOOK_SCRIPTS);
  } else if (options.hooks) {
    hooksToInstall = options.hooks.split(',').map(h => h.trim());
  } else {
    hooksToInstall = ['pre-commit']; // default
  }

  for (const hook of hooksToInstall) {
    const script = HOOK_SCRIPTS[hook];
    if (!script) {
      warn(`Unknown hook: ${hook}. Available: ${Object.keys(HOOK_SCRIPTS).join(', ')}`);
      continue;
    }

    // Write to .ralph/hooks/
    const ralphHookPath = join(ralphHooksDir, hook);
    safeWriteFile(ralphHookPath, script);
    chmodSync(ralphHookPath, '755');

    // Copy to .git/hooks/
    const gitHookPath = join(gitHooksDir, hook);
    if (existsSync(gitHookPath)) {
      const existing = readFileSync(gitHookPath, 'utf-8');
      if (!existing.includes('ralph-cli')) {
        warn(`${hook} hook already exists and is not a ralph hook. Skipping.`);
        continue;
      }
    }
    safeWriteFile(gitHookPath, script);
    chmodSync(gitHookPath, '755');
    success(`Installed ${hook} hook`);
  }
}

export function hooksUninstallCommand(): void {
  const projectRoot = findProjectRoot(process.cwd());
  const gitHooksDir = join(projectRoot, '.git', 'hooks');

  for (const hook of Object.keys(HOOK_SCRIPTS)) {
    const gitHookPath = join(gitHooksDir, hook);
    if (existsSync(gitHookPath)) {
      const content = readFileSync(gitHookPath, 'utf-8');
      if (content.includes('ralph-cli')) {
        unlinkSync(gitHookPath);
        success(`Uninstalled ${hook} hook`);
      }
    }
  }

  // Clean up .ralph/hooks/
  const ralphHooksDir = join(projectRoot, '.ralph', 'hooks');
  if (existsSync(ralphHooksDir)) {
    for (const file of readdirSync(ralphHooksDir)) {
      unlinkSync(join(ralphHooksDir, file));
    }
    success('Cleaned .ralph/hooks/');
  }
}
