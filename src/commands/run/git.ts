import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import * as output from '../../utils/output.js';

export function captureCurrentBranch(): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

export function captureUntrackedFiles(): string[] {
  try {
    const result = execSync('git ls-files --others --exclude-standard', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return result ? result.split('\n').filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function revertToBaseline(
  baselineCommit: string,
  originalBranch: string,
  preAgentUntracked: string[],
): void {
  // Step 1: Remove stale git locks
  try {
    execSync('rm -f .git/index.lock .git/refs/heads/*.lock', { stdio: 'pipe' });
  } catch { /* ignore */ }

  // Step 2: Verify and restore branch
  try {
    const currentBranch = captureCurrentBranch();
    if (currentBranch && originalBranch && currentBranch !== originalBranch) {
      output.warn(`Agent switched to branch ${currentBranch} — restoring ${originalBranch}`);
      execSync(`git checkout ${originalBranch}`, { stdio: 'pipe' });
    }
  } catch { /* ignore */ }

  // Step 3: Reset to baseline
  if (baselineCommit) {
    try {
      execSync(`git reset --hard ${baselineCommit}`, { stdio: 'pipe' });
    } catch { /* ignore */ }
  }

  // Step 4-5: Remove only new untracked files
  const currentUntracked = captureUntrackedFiles();
  const preAgentSet = new Set(preAgentUntracked);
  for (const f of currentUntracked) {
    if (!preAgentSet.has(f)) {
      try { rmSync(f, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}
