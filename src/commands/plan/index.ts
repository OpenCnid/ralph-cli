import { existsSync, readFileSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { loadConfig, findProjectRoot } from '../../config/index.js';
import { ensureDir, safeWriteFile, safeReadFile } from '../../utils/fs.js';
import { success, warn, error, info } from '../../utils/index.js';

function getNextPlanId(plansDir: string): string {
  const activeDir = join(plansDir, 'active');
  const completedDir = join(plansDir, 'completed');
  let maxId = -1;

  for (const dir of [activeDir, completedDir]) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      const match = file.match(/^(\d+)-/);
      if (match?.[1]) {
        const id = parseInt(match[1], 10);
        if (id > maxId) maxId = id;
      }
    }
  }

  return String(maxId + 1).padStart(3, '0');
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
}

function today(): string {
  return new Date().toISOString().split('T')[0]!;
}

function now(): string {
  const d = new Date();
  return `${d.toISOString().split('T')[0]} ${d.toTimeString().split(' ')[0]!.slice(0, 5)}`;
}

function getCompletionPercentage(content: string): { checked: number; total: number; pct: number } {
  const checked = (content.match(/- \[x\]/gi) ?? []).length;
  const unchecked = (content.match(/- \[ \]/g) ?? []).length;
  const total = checked + unchecked;
  const pct = total > 0 ? Math.round((checked / total) * 100) : 0;
  return { checked, total, pct };
}

function ensureTechDebtTracker(plansDir: string): void {
  const trackerPath = join(plansDir, 'tech-debt-tracker.md');
  if (existsSync(trackerPath)) return;
  const content = `# Tech Debt Tracker

| ID | Description | Priority | Discovered Date | Related Plan |
|----|-------------|----------|-----------------|--------------|

## Priority Levels

- **P0** — Blocking current work or causing incidents
- **P1** — Should be addressed soon, increasing friction
- **P2** — Nice to fix, low impact
- **P3** — Cosmetic or negligible impact
`;
  safeWriteFile(trackerPath, content);
}

function updateIndex(plansDir: string): void {
  const activeDir = join(plansDir, 'active');
  const completedDir = join(plansDir, 'completed');

  let md = `# Execution Plans\n\n`;
  md += `| ID | Title | Status | Created |\n`;
  md += `|----|-------|--------|----------|\n`;

  // Active plans
  if (existsSync(activeDir)) {
    for (const file of readdirSync(activeDir).sort()) {
      if (!file.endsWith('.md')) continue;
      const content = safeReadFile(join(activeDir, file)) ?? '';
      const titleMatch = content.match(/^# Plan: (.+)$/m);
      const dateMatch = content.match(/^Created: (.+)$/m);
      const title = titleMatch?.[1] ?? file.replace('.md', '');
      const date = dateMatch?.[1] ?? '';
      const id = file.match(/^(\d+)/)?.[1] ?? '';
      md += `| ${id} | ${title} | active | ${date} |\n`;
    }
  }

  // Completed plans
  if (existsSync(completedDir)) {
    for (const file of readdirSync(completedDir).sort()) {
      if (!file.endsWith('.md')) continue;
      const content = safeReadFile(join(completedDir, file)) ?? '';
      const titleMatch = content.match(/^# Plan: (.+)$/m);
      const dateMatch = content.match(/^Created: (.+)$/m);
      const statusMatch = content.match(/^Status: (.+)$/m);
      const title = titleMatch?.[1] ?? file.replace('.md', '');
      const date = dateMatch?.[1] ?? '';
      const status = statusMatch?.[1] ?? 'completed';
      const id = file.match(/^(\d+)/)?.[1] ?? '';
      md += `| ${id} | ${title} | ${status} | ${date} |\n`;
    }
  }

  md += `\nPlans in \`active/\` are currently being worked on.\n`;
  md += `Completed or abandoned plans are moved to \`completed/\`.\n\n`;
  md += `See [tech-debt-tracker.md](tech-debt-tracker.md) for known technical debt.\n`;

  safeWriteFile(join(plansDir, 'index.md'), md);
}

export function planCreateCommand(title: string, options: { full?: boolean }): void {
  const projectRoot = findProjectRoot(process.cwd());
  const { config } = loadConfig(projectRoot);
  const plansDir = join(projectRoot, config.paths.plans);
  const activeDir = join(plansDir, 'active');
  ensureDir(activeDir);
  ensureDir(join(plansDir, 'completed'));
  ensureTechDebtTracker(plansDir);

  const id = getNextPlanId(plansDir);
  const slug = slugify(title);
  const filename = `${id}-${slug}.md`;
  const filePath = join(activeDir, filename);

  let content: string;
  if (options.full) {
    content = `# Plan: ${title}

Created: ${today()}
Status: active

## Context

Why this work is happening and what success looks like.

## Tasks

- [ ] Task 1
- [ ] Task 2
- [ ] Task 3
- [ ] Task 4

## Decisions

Decisions made during execution, logged as they happen.

## Dependencies

What this plan depends on and what depends on it.

## Risks

Known risks and mitigation strategies.
`;
  } else {
    content = `# Plan: ${title}

Created: ${today()}
Status: active

## Tasks

- [ ] Task 1
- [ ] Task 2
- [ ] Task 3
`;
  }

  safeWriteFile(filePath, content);
  updateIndex(plansDir);
  success(`Created plan ${id}: ${config.paths.plans}/active/${filename}`);
}

export function planCompleteCommand(id: string, options?: { reason?: string | undefined }): void {
  const projectRoot = findProjectRoot(process.cwd());
  const { config } = loadConfig(projectRoot);
  const plansDir = join(projectRoot, config.paths.plans);
  const activeDir = join(plansDir, 'active');
  const completedDir = join(plansDir, 'completed');
  ensureDir(completedDir);

  const file = findPlanFile(activeDir, id);
  if (!file) {
    error(`No active plan found with ID ${id}`);
    process.exit(1);
  }

  // Update status in file
  const content = readFileSync(join(activeDir, file), 'utf-8');
  const reasonLine = options?.reason ? `\nReason: ${options.reason}` : '';
  const updated = content.replace(/^Status: active$/m, `Status: completed\nCompleted: ${today()}${reasonLine}`);
  safeWriteFile(join(completedDir, file), updated);

  // Remove from active
  unlinkSync(join(activeDir, file));

  updateIndex(plansDir);
  success(`Completed plan ${id}: moved to ${config.paths.plans}/completed/${file}`);
}

export function planAbandonCommand(id: string, options: { reason?: string }): void {
  const projectRoot = findProjectRoot(process.cwd());
  const { config } = loadConfig(projectRoot);
  const plansDir = join(projectRoot, config.paths.plans);
  const activeDir = join(plansDir, 'active');
  const completedDir = join(plansDir, 'completed');
  ensureDir(completedDir);

  const file = findPlanFile(activeDir, id);
  if (!file) {
    error(`No active plan found with ID ${id}`);
    process.exit(1);
  }

  const reason = options.reason ?? 'No reason provided';
  const content = readFileSync(join(activeDir, file), 'utf-8');
  const updated = content.replace(
    /^Status: active$/m,
    `Status: abandoned\nAbandoned: ${today()}\nReason: ${reason}`
  );
  safeWriteFile(join(completedDir, file), updated);

  unlinkSync(join(activeDir, file));

  updateIndex(plansDir);
  success(`Abandoned plan ${id}: ${reason}`);
}

export function planLogCommand(id: string, decision: string): void {
  const projectRoot = findProjectRoot(process.cwd());
  const { config } = loadConfig(projectRoot);
  const plansDir = join(projectRoot, config.paths.plans);
  const activeDir = join(plansDir, 'active');

  const file = findPlanFile(activeDir, id);
  if (!file) {
    error(`No active plan found with ID ${id}`);
    process.exit(1);
  }

  const filePath = join(activeDir, file);
  let content = readFileSync(filePath, 'utf-8');

  const entry = `\n- **${now()}** — ${decision}`;

  // Append after ## Decisions section
  const decisionsIndex = content.indexOf('## Decisions');
  if (decisionsIndex !== -1) {
    const nextSection = content.indexOf('\n## ', decisionsIndex + 1);
    if (nextSection !== -1) {
      content = content.slice(0, nextSection) + entry + '\n' + content.slice(nextSection);
    } else {
      content = content + entry + '\n';
    }
  } else {
    // Add decisions section
    content += `\n## Decisions\n${entry}\n`;
  }

  safeWriteFile(filePath, content);
  success(`Logged decision to plan ${id}`);
}

export function planListCommand(options: { all?: boolean }): void {
  const projectRoot = findProjectRoot(process.cwd());
  const { config } = loadConfig(projectRoot);
  const plansDir = join(projectRoot, config.paths.plans);
  const activeDir = join(plansDir, 'active');
  const completedDir = join(plansDir, 'completed');

  info('Active Plans:');
  if (existsSync(activeDir)) {
    const files = readdirSync(activeDir).filter(f => f.endsWith('.md')).sort();
    if (files.length === 0) {
      console.log('  (none)');
    }
    for (const file of files) {
      const content = safeReadFile(join(activeDir, file)) ?? '';
      const titleMatch = content.match(/^# Plan: (.+)$/m);
      const title = titleMatch?.[1] ?? file;
      const { pct } = getCompletionPercentage(content);
      const id = file.match(/^(\d+)/)?.[1] ?? '';
      console.log(`  ${id}: ${title} (${pct}% complete)`);
    }
  } else {
    console.log('  (none)');
  }

  if (options.all && existsSync(completedDir)) {
    console.log('');
    info('Completed/Abandoned Plans:');
    const files = readdirSync(completedDir).filter(f => f.endsWith('.md')).sort();
    if (files.length === 0) {
      console.log('  (none)');
    }
    for (const file of files) {
      const content = safeReadFile(join(completedDir, file)) ?? '';
      const titleMatch = content.match(/^# Plan: (.+)$/m);
      const statusMatch = content.match(/^Status: (.+)$/m);
      const title = titleMatch?.[1] ?? file;
      const status = statusMatch?.[1] ?? 'completed';
      const id = file.match(/^(\d+)/)?.[1] ?? '';
      console.log(`  ${id}: ${title} [${status}]`);
    }
  }
}

export function planStatusCommand(): void {
  const projectRoot = findProjectRoot(process.cwd());
  const { config } = loadConfig(projectRoot);
  const plansDir = join(projectRoot, config.paths.plans);
  const activeDir = join(plansDir, 'active');

  if (!existsSync(activeDir)) {
    info('No active plans.');
    return;
  }

  const files = readdirSync(activeDir).filter(f => f.endsWith('.md')).sort();
  if (files.length === 0) {
    info('No active plans.');
    return;
  }

  info(`${files.length} active plan(s):`);
  for (const file of files) {
    const content = safeReadFile(join(activeDir, file)) ?? '';
    const titleMatch = content.match(/^# Plan: (.+)$/m);
    const title = titleMatch?.[1] ?? file;
    const { checked, total, pct } = getCompletionPercentage(content);
    const id = file.match(/^(\d+)/)?.[1] ?? '';
    console.log(`  ${id}: ${title}`);
    console.log(`      ${checked}/${total} tasks (${pct}% complete)`);
  }
}

function findPlanFile(dir: string, id: string): string | null {
  if (!existsSync(dir)) return null;
  const paddedId = id.padStart(3, '0');
  const files = readdirSync(dir).filter(f => f.startsWith(paddedId + '-') && f.endsWith('.md'));
  return files[0] ?? null;
}
