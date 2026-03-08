import { existsSync, readFileSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { loadConfig, findProjectRoot } from '../../config/index.js';
import { ensureDir, safeWriteFile, safeReadFile } from '../../utils/fs.js';
import { success, warn, error, info, plain } from '../../utils/index.js';

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

function generateTasks(title: string, full: boolean): string[] {
  const lower = title.toLowerCase();
  const taskCount = full ? 4 : 3;

  // Detect action from title (use word-start \b with trailing .* to match word stems)
  if (/\b(fix|bug|issue|error|crash)\b/.test(lower)) {
    const tasks = [
      'Reproduce the issue and document expected vs actual behavior',
      'Identify root cause',
      'Implement fix',
      'Add regression test to prevent recurrence',
    ];
    return tasks.slice(0, taskCount);
  }
  if (/\b(migrat\w*|mov\w+|convert|switch|transition)\b/.test(lower)) {
    const tasks = [
      'Research target approach and document trade-offs',
      'Design migration strategy with rollback plan',
      'Implement migration',
      'Verify migration with integration tests',
    ];
    return tasks.slice(0, taskCount);
  }
  if (/\b(refactor\w*|restructur\w*|reorganiz\w*|clean\s*up|simplif\w*)\b/.test(lower)) {
    const tasks = [
      'Identify scope and affected files',
      'Implement refactoring in stages',
      'Update tests to match new structure',
      'Verify no behavioral regressions',
    ];
    return tasks.slice(0, taskCount);
  }
  if (/\b(remov\w*|delet\w*|deprecat\w*|drop)\b/.test(lower)) {
    const tasks = [
      'Identify all usages and dependents',
      'Remove the target code/feature',
      'Update tests and references',
      'Verify no broken dependencies',
    ];
    return tasks.slice(0, taskCount);
  }
  if (/\b(upgrad\w*|updat\w+|bump)\b/.test(lower)) {
    const tasks = [
      'Check compatibility and breaking changes',
      'Implement upgrade',
      'Test for regressions across affected areas',
      'Update documentation to reflect changes',
    ];
    return tasks.slice(0, taskCount);
  }
  if (/\b(add|implement\w*|creat\w*|build|introduc\w*)\b/.test(lower)) {
    const tasks = [
      'Design approach and identify integration points',
      'Implement core functionality',
      'Add tests covering key scenarios',
      'Update documentation',
    ];
    return tasks.slice(0, taskCount);
  }

  // Default: generic but still actionable
  const tasks = [
    'Analyze requirements and define scope',
    'Implement changes',
    'Add or update tests',
    'Update documentation if needed',
  ];
  return tasks.slice(0, taskCount);
}

function getCompletionPercentage(content: string): { checked: number; total: number; pct: number } {
  const checked = (content.match(/- \[x\]/gi) ?? []).length;
  const unchecked = (content.match(/- \[ \]/g) ?? []).length;
  const total = checked + unchecked;
  const pct = total > 0 ? Math.round((checked / total) * 100) : 0;
  return { checked, total, pct };
}

interface PlanInfo {
  id: string;
  title: string;
  status: string;
  created: string;
  completion: { checked: number; total: number; pct: number };
  file: string;
}

function parsePlanInfo(dir: string, filename: string): PlanInfo {
  const content = safeReadFile(join(dir, filename)) ?? '';
  const titleMatch = content.match(/^# Plan: (.+)$/m);
  const statusMatch = content.match(/^Status: (.+)$/m);
  const dateMatch = content.match(/^Created: (.+)$/m);
  return {
    id: filename.match(/^(\d+)/)?.[1] ?? '',
    title: titleMatch?.[1] ?? filename.replace('.md', ''),
    status: statusMatch?.[1] ?? 'active',
    created: dateMatch?.[1] ?? '',
    completion: getCompletionPercentage(content),
    file: filename,
  };
}

function ensureTechDebtTracker(plansDir: string): void {
  const trackerPath = join(plansDir, 'tech-debt-tracker.md');
  if (existsSync(trackerPath)) return;
  const content = `# Tech Debt Tracker

| ID | Description | Priority | Discovered | Plan |
|----|-------------|----------|------------|------|

## Priority Levels

- **High** — Blocking current work or causing incidents
- **Medium** — Should be addressed soon, increasing friction
- **Low** — Nice to fix, low impact
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

  const tasks = generateTasks(title, !!options.full);
  const taskLines = tasks.map(t => `- [ ] ${t}`).join('\n');

  let content: string;
  if (options.full) {
    content = `# Plan: ${title}

Created: ${today()}
Status: active
Estimated scope: ${tasks.length}–${tasks.length + Math.ceil(tasks.length * 0.5)} tasks

## Context

Why this work is happening and what success looks like.

## Tasks

${taskLines}

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

${taskLines}
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

export function planListCommand(options: { all?: boolean; json?: boolean }): void {
  const projectRoot = findProjectRoot(process.cwd());
  const { config } = loadConfig(projectRoot);
  const plansDir = join(projectRoot, config.paths.plans);
  const activeDir = join(plansDir, 'active');
  const completedDir = join(plansDir, 'completed');

  if (options.json) {
    const plans: PlanInfo[] = [];
    if (existsSync(activeDir)) {
      for (const file of readdirSync(activeDir).filter(f => f.endsWith('.md')).sort()) {
        plans.push(parsePlanInfo(activeDir, file));
      }
    }
    if (options.all && existsSync(completedDir)) {
      for (const file of readdirSync(completedDir).filter(f => f.endsWith('.md')).sort()) {
        plans.push(parsePlanInfo(completedDir, file));
      }
    }
    plain(JSON.stringify({ plans }, null, 2));
    return;
  }

  info('Active Plans:');
  if (existsSync(activeDir)) {
    const files = readdirSync(activeDir).filter(f => f.endsWith('.md')).sort();
    if (files.length === 0) {
      plain('  (none)');
    }
    for (const file of files) {
      const p = parsePlanInfo(activeDir, file);
      plain(`  ${p.id}: ${p.title} (${p.completion.pct}% complete)`);
    }
  } else {
    plain('  (none)');
  }

  if (options.all && existsSync(completedDir)) {
    plain('');
    info('Completed/Abandoned Plans:');
    const files = readdirSync(completedDir).filter(f => f.endsWith('.md')).sort();
    if (files.length === 0) {
      plain('  (none)');
    }
    for (const file of files) {
      const p = parsePlanInfo(completedDir, file);
      plain(`  ${p.id}: ${p.title} [${p.status}]`);
    }
  }
}

export function planStatusCommand(options?: { json?: boolean }): void {
  const projectRoot = findProjectRoot(process.cwd());
  const { config } = loadConfig(projectRoot);
  const plansDir = join(projectRoot, config.paths.plans);
  const activeDir = join(plansDir, 'active');

  if (!existsSync(activeDir)) {
    if (options?.json) {
      plain(JSON.stringify({ active: [], total: 0 }, null, 2));
    } else {
      info('No active plans.');
    }
    return;
  }

  const files = readdirSync(activeDir).filter(f => f.endsWith('.md')).sort();
  if (files.length === 0) {
    if (options?.json) {
      plain(JSON.stringify({ active: [], total: 0 }, null, 2));
    } else {
      info('No active plans.');
    }
    return;
  }

  const plans = files.map(file => parsePlanInfo(activeDir, file));

  if (options?.json) {
    plain(JSON.stringify({ active: plans, total: plans.length }, null, 2));
    return;
  }

  info(`${files.length} active plan(s):`);
  for (const p of plans) {
    plain(`  ${p.id}: ${p.title}`);
    plain(`      ${p.completion.checked}/${p.completion.total} tasks (${p.completion.pct}% complete)`);
  }
}

function findPlanFile(dir: string, id: string): string | null {
  if (!existsSync(dir)) return null;
  const paddedId = id.padStart(3, '0');
  const files = readdirSync(dir).filter(f => f.startsWith(paddedId + '-') && f.endsWith('.md'));
  return files[0] ?? null;
}
