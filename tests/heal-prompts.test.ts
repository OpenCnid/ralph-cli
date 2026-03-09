import { describe, expect, it } from 'vitest';
import { generateHealPrompt, HEAL_TEMPLATE } from '../src/commands/heal/prompts.js';
import type { HealContext } from '../src/commands/heal/types.js';

function makeContext(overrides: Partial<HealContext> = {}): HealContext {
  return {
    projectName: 'ralph-cli',
    totalIssues: 3,
    diagnostics: [
      {
        command: 'ralph doctor',
        issues: 1,
        exitCode: 1,
        output: '✗ AGENTS.md missing or empty',
      },
      {
        command: 'ralph lint',
        issues: 2,
        exitCode: 1,
        output: '✗ src/cli.ts: dependency violation',
      },
    ],
    ...overrides,
  };
}

describe('HEAL_TEMPLATE', () => {
  it('contains all required template variables', () => {
    expect(HEAL_TEMPLATE).toContain('{project_name}');
    expect(HEAL_TEMPLATE).toContain('{project_path}');
    expect(HEAL_TEMPLATE).toContain('{date}');
    expect(HEAL_TEMPLATE).toContain('{diagnostics_output}');
    expect(HEAL_TEMPLATE).toContain('{validate_command}');
  });

  it('includes the required fix priority order', () => {
    expect(HEAL_TEMPLATE).toContain('1. doctor');
    expect(HEAL_TEMPLATE).toContain('2. lint');
    expect(HEAL_TEMPLATE).toContain('3. gc');
    expect(HEAL_TEMPLATE).toContain('4. grade');
  });

  it('tells the agent to rerun failing commands after each fix', () => {
    expect(HEAL_TEMPLATE).toContain('rerun the failing command');
  });
});

describe('generateHealPrompt', () => {
  it('substitutes all required variables', () => {
    const prompt = generateHealPrompt(
      makeContext(),
      'npm test && npx tsc --noEmit && ralph doctor --ci && ralph grade --ci',
      '/tmp/ralph-cli',
      '2026-03-09',
    );

    expect(prompt).toContain('ralph-cli');
    expect(prompt).toContain('/tmp/ralph-cli');
    expect(prompt).toContain('2026-03-09');
    expect(prompt).toContain('npm test && npx tsc --noEmit');
    expect(prompt).not.toMatch(/\{[a-z_]+\}/);
  });

  it('formats diagnostics output as per-command sections', () => {
    const prompt = generateHealPrompt(
      makeContext(),
      'npm test && ralph doctor --ci && ralph grade --ci',
      '/tmp/ralph-cli',
      '2026-03-09',
    );

    expect(prompt).toContain('### ralph doctor');
    expect(prompt).toContain('Issues: 1');
    expect(prompt).toContain('Exit code: 1');
    expect(prompt).toContain('✗ AGENTS.md missing or empty');
    expect(prompt).toContain('### ralph lint');
    expect(prompt).toContain('---');
  });

  it('uses (none) when diagnostics are empty', () => {
    const prompt = generateHealPrompt(
      makeContext({ diagnostics: [], totalIssues: 0 }),
      'ralph doctor --ci && ralph grade --ci',
      '/tmp/ralph-cli',
      '2026-03-09',
    );

    expect(prompt).toContain('## Diagnostics Output\n(none)');
  });
});
