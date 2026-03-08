import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { planCreateCommand, planCompleteCommand, planAbandonCommand, planLogCommand, planListCommand, planStatusCommand } from './index.js';

function makeTempDir(): string {
  const dir = join(tmpdir(), `ralph-plan-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('plan commands', () => {
  let tempDir: string;
  const origCwd = process.cwd();

  beforeEach(() => {
    tempDir = makeTempDir();
    mkdirSync(join(tempDir, '.git'), { recursive: true });
    mkdirSync(join(tempDir, '.ralph'), { recursive: true });
    writeFileSync(join(tempDir, '.ralph', 'config.yml'), 'project:\n  name: test\n  language: typescript\n');
    mkdirSync(join(tempDir, 'docs', 'exec-plans', 'active'), { recursive: true });
    mkdirSync(join(tempDir, 'docs', 'exec-plans', 'completed'), { recursive: true });
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates a lightweight plan', () => {
    planCreateCommand('Add input validation', {});

    const files = readdirSync(join(tempDir, 'docs', 'exec-plans', 'active'));
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^000-add-input-validation\.md$/);

    const content = readFileSync(join(tempDir, 'docs', 'exec-plans', 'active', files[0]!), 'utf-8');
    expect(content).toContain('# Plan: Add input validation');
    expect(content).toContain('Status: active');
    expect(content).toContain('## Tasks');
    expect(content).not.toContain('## Context'); // lightweight = no context section
  });

  it('creates a full plan with --full', () => {
    planCreateCommand('Migrate auth system', { full: true });

    const files = readdirSync(join(tempDir, 'docs', 'exec-plans', 'active'));
    const content = readFileSync(join(tempDir, 'docs', 'exec-plans', 'active', files[0]!), 'utf-8');
    expect(content).toContain('## Context');
    expect(content).toContain('## Decisions');
    expect(content).toContain('## Dependencies');
    expect(content).toContain('## Risks');
  });

  it('auto-increments plan IDs', () => {
    planCreateCommand('First plan', {});
    planCreateCommand('Second plan', {});

    const files = readdirSync(join(tempDir, 'docs', 'exec-plans', 'active')).sort();
    expect(files.length).toBe(2);
    expect(files[0]).toMatch(/^000-/);
    expect(files[1]).toMatch(/^001-/);
  });

  it('updates index.md on create', () => {
    planCreateCommand('Test plan', {});

    const index = readFileSync(join(tempDir, 'docs', 'exec-plans', 'index.md'), 'utf-8');
    expect(index).toContain('Test plan');
    expect(index).toContain('active');
  });

  it('completes a plan', () => {
    planCreateCommand('Plan to complete', {});
    planCompleteCommand('0');

    expect(readdirSync(join(tempDir, 'docs', 'exec-plans', 'active')).filter(f => f.endsWith('.md')).length).toBe(0);
    const completedFiles = readdirSync(join(tempDir, 'docs', 'exec-plans', 'completed')).filter(f => f.endsWith('.md'));
    expect(completedFiles.length).toBe(1);

    const content = readFileSync(join(tempDir, 'docs', 'exec-plans', 'completed', completedFiles[0]!), 'utf-8');
    expect(content).toContain('Status: completed');
  });

  it('completes a plan with --reason', () => {
    planCreateCommand('Plan with reason', {});
    planCompleteCommand('0', { reason: 'All tasks done and verified' });

    const completedFiles = readdirSync(join(tempDir, 'docs', 'exec-plans', 'completed')).filter(f => f.endsWith('.md'));
    const content = readFileSync(join(tempDir, 'docs', 'exec-plans', 'completed', completedFiles[0]!), 'utf-8');
    expect(content).toContain('Status: completed');
    expect(content).toContain('Reason: All tasks done and verified');
  });

  it('abandons a plan with reason', () => {
    planCreateCommand('Plan to abandon', {});
    planAbandonCommand('0', { reason: 'Descoped from sprint' });

    const completedFiles = readdirSync(join(tempDir, 'docs', 'exec-plans', 'completed')).filter(f => f.endsWith('.md'));
    expect(completedFiles.length).toBe(1);

    const content = readFileSync(join(tempDir, 'docs', 'exec-plans', 'completed', completedFiles[0]!), 'utf-8');
    expect(content).toContain('Status: abandoned');
    expect(content).toContain('Descoped from sprint');
  });

  it('logs a decision to a plan', () => {
    planCreateCommand('Decision plan', { full: true });
    planLogCommand('0', 'Chose JWT over session tokens for stateless API');

    const files = readdirSync(join(tempDir, 'docs', 'exec-plans', 'active'));
    const content = readFileSync(join(tempDir, 'docs', 'exec-plans', 'active', files[0]!), 'utf-8');
    expect(content).toContain('Chose JWT over session tokens');
    expect(content).toMatch(/\*\*\d{4}-\d{2}-\d{2} \d{2}:\d{2}\*\*/); // timestamp format
  });

  it('auto-creates tech-debt-tracker.md on first plan create', () => {
    // Remove the tracker if it exists from setup
    const trackerPath = join(tempDir, 'docs', 'exec-plans', 'tech-debt-tracker.md');
    expect(existsSync(trackerPath)).toBe(false);

    planCreateCommand('First plan', {});

    expect(existsSync(trackerPath)).toBe(true);
    const content = readFileSync(trackerPath, 'utf-8');
    expect(content).toContain('# Tech Debt Tracker');
    expect(content).toContain('| ID | Description | Priority | Discovered Date | Related Plan |');
    expect(content).toContain('P0');
  });

  it('does not overwrite existing tech-debt-tracker.md', () => {
    const trackerPath = join(tempDir, 'docs', 'exec-plans', 'tech-debt-tracker.md');
    writeFileSync(trackerPath, '# Tech Debt Tracker\n\n| ID | Description |\n| TD-1 | Fix auth bug |\n');

    planCreateCommand('New plan', {});

    const content = readFileSync(trackerPath, 'utf-8');
    expect(content).toContain('Fix auth bug');
  });

  it('updates index on complete/abandon', () => {
    planCreateCommand('Active plan', {});
    planCreateCommand('Completed plan', {});
    planCompleteCommand('1');

    const index = readFileSync(join(tempDir, 'docs', 'exec-plans', 'index.md'), 'utf-8');
    expect(index).toContain('Active plan');
    expect(index).toContain('active');
    expect(index).toContain('completed');
  });

  it('plan list --json outputs structured JSON', () => {
    planCreateCommand('JSON test plan', {});
    planCreateCommand('Another plan', {});

    const originalLog = console.log;
    let output = '';
    console.log = (msg: string) => { output += msg; };
    planListCommand({ json: true });
    console.log = originalLog;

    const result = JSON.parse(output) as { plans: Array<{ id: string; title: string; status: string; completion: { pct: number } }> };
    expect(result.plans).toHaveLength(2);
    expect(result.plans[0]!.title).toBe('JSON test plan');
    expect(result.plans[0]!.status).toBe('active');
    expect(result.plans[0]!.completion.pct).toBe(0);
  });

  it('plan status --json outputs structured JSON', () => {
    planCreateCommand('Status JSON plan', {});

    const originalLog = console.log;
    let output = '';
    console.log = (msg: string) => { output += msg; };
    planStatusCommand({ json: true });
    console.log = originalLog;

    const result = JSON.parse(output) as { active: Array<{ id: string; title: string }>; total: number };
    expect(result.total).toBe(1);
    expect(result.active).toHaveLength(1);
    expect(result.active[0]!.title).toBe('Status JSON plan');
  });
});
