import { describe, it, expect } from 'vitest';
import { generateReviewPrompt, REVIEW_TEMPLATE } from '../src/commands/review/prompts.js';
import type { ReviewContext } from '../src/commands/review/types.js';

function makeContext(overrides: Partial<ReviewContext> = {}): ReviewContext {
  return {
    diff: 'diff --git a/src/foo.ts b/src/foo.ts\n+export function foo() {}',
    diffStat: ' src/foo.ts | 1 +\n 1 file changed',
    changedFiles: ['src/foo.ts'],
    architecture: '# Architecture\nLayer: commands',
    specs: ['# Spec\nSome spec content'],
    rules: 'Never use require()',
    projectName: 'test-project',
    scope: 'staged',
    ...overrides,
  };
}

describe('REVIEW_TEMPLATE', () => {
  it('contains all required template variables', () => {
    expect(REVIEW_TEMPLATE).toContain('{project_name}');
    expect(REVIEW_TEMPLATE).toContain('{architecture_content}');
    expect(REVIEW_TEMPLATE).toContain('{specs_content}');
    expect(REVIEW_TEMPLATE).toContain('{rules_content}');
    expect(REVIEW_TEMPLATE).toContain('{diff_stat}');
    expect(REVIEW_TEMPLATE).toContain('{diff_content}');
  });

  it('contains all 6 required sections', () => {
    expect(REVIEW_TEMPLATE).toContain('## Project Architecture');
    expect(REVIEW_TEMPLATE).toContain('## Relevant Specifications');
    expect(REVIEW_TEMPLATE).toContain('## Project Rules');
    expect(REVIEW_TEMPLATE).toContain('## Changes to Review');
    expect(REVIEW_TEMPLATE).toContain('### Files Changed');
    expect(REVIEW_TEMPLATE).toContain('### Diff');
    expect(REVIEW_TEMPLATE).toContain('## Review Instructions');
  });

  it('contains APPROVE/REQUEST_CHANGES/CONCERNS in review instructions', () => {
    expect(REVIEW_TEMPLATE).toContain('APPROVE');
    expect(REVIEW_TEMPLATE).toContain('REQUEST_CHANGES');
    expect(REVIEW_TEMPLATE).toContain('CONCERNS');
  });
});

describe('generateReviewPrompt', () => {
  it('substitutes all template variables', () => {
    const ctx = makeContext();
    const prompt = generateReviewPrompt(ctx, { diffOnly: false });

    expect(prompt).toContain('test-project');
    expect(prompt).toContain('# Architecture');
    expect(prompt).toContain('# Spec');
    expect(prompt).toContain('Never use require()');
    expect(prompt).toContain('src/foo.ts | 1 +');
    expect(prompt).toContain('diff --git a/src/foo.ts');
  });

  it('does not leave any unfilled placeholders', () => {
    const ctx = makeContext();
    const prompt = generateReviewPrompt(ctx, { diffOnly: false });
    expect(prompt).not.toMatch(/\{[a-z_]+\}/);
  });

  it('joins multiple specs with separator', () => {
    const ctx = makeContext({ specs: ['# Spec A', '# Spec B'] });
    const prompt = generateReviewPrompt(ctx, { diffOnly: false });
    expect(prompt).toContain('# Spec A');
    expect(prompt).toContain('# Spec B');
    expect(prompt).toContain('---');
  });

  it('uses (none) when specs is empty', () => {
    const ctx = makeContext({ specs: [] });
    const prompt = generateReviewPrompt(ctx, { diffOnly: false });
    expect(prompt).toContain('## Relevant Specifications\n(none)');
  });

  it('uses (none) when architecture is empty string', () => {
    const ctx = makeContext({ architecture: '' });
    const prompt = generateReviewPrompt(ctx, { diffOnly: false });
    expect(prompt).toContain('## Project Architecture\n(none)');
  });

  it('uses (none) when rules is empty string', () => {
    const ctx = makeContext({ rules: '' });
    const prompt = generateReviewPrompt(ctx, { diffOnly: false });
    expect(prompt).toContain('## Project Rules\n(none)');
  });

  describe('--diff-only', () => {
    it('excludes architecture section', () => {
      const ctx = makeContext();
      const prompt = generateReviewPrompt(ctx, { diffOnly: true });
      expect(prompt).not.toContain('## Project Architecture');
      expect(prompt).not.toContain('# Architecture');
    });

    it('excludes specs section', () => {
      const ctx = makeContext();
      const prompt = generateReviewPrompt(ctx, { diffOnly: true });
      expect(prompt).not.toContain('## Relevant Specifications');
      expect(prompt).not.toContain('# Spec');
    });

    it('excludes rules section', () => {
      const ctx = makeContext();
      const prompt = generateReviewPrompt(ctx, { diffOnly: true });
      expect(prompt).not.toContain('## Project Rules');
      expect(prompt).not.toContain('Never use require()');
    });

    it('still includes diff and review instructions', () => {
      const ctx = makeContext();
      const prompt = generateReviewPrompt(ctx, { diffOnly: true });
      expect(prompt).toContain('## Changes to Review');
      expect(prompt).toContain('diff --git a/src/foo.ts');
      expect(prompt).toContain('## Review Instructions');
    });

    it('still includes project name', () => {
      const ctx = makeContext();
      const prompt = generateReviewPrompt(ctx, { diffOnly: true });
      expect(prompt).toContain('test-project');
    });
  });
});
