import { describe, it, expect } from 'vitest';
import { generateReviewPrompt } from './prompts.js';
import type { ReviewContext } from './types.js';

function makeContext(overrides: Partial<ReviewContext> = {}): ReviewContext {
  return {
    diff: 'diff --git a/foo.ts b/foo.ts\n+const x = 1;',
    diffStat: 'foo.ts | 1 +',
    changedFiles: ['foo.ts'],
    architecture: 'layers: [ui, logic, data]',
    specs: ['# Spec\n## Requirements\n- req 1'],
    rules: 'no circular imports',
    projectName: 'test-project',
    scope: 'HEAD~1',
    motivations: [],
    ...overrides,
  };
}

describe('generateReviewPrompt', () => {
  it('intent=false returns standard template without "Problem Context"', () => {
    const result = generateReviewPrompt(makeContext(), { diffOnly: false, intent: false });
    expect(result).not.toContain('Problem Context');
    expect(result).toContain('Spec compliance');
  });

  it('intent=true returns intent template containing "Problem Context"', () => {
    const result = generateReviewPrompt(makeContext(), { diffOnly: false, intent: true });
    expect(result).toContain('Problem Context');
  });

  it('intent=true with non-empty motivations includes motivation text in prompt', () => {
    const ctx = makeContext({ motivations: ['Prevent credential stuffing per user account'] });
    const result = generateReviewPrompt(ctx, { diffOnly: false, intent: true });
    expect(result).toContain('Prevent credential stuffing per user account');
  });

  it('intent=true with empty motivations includes "no motivation sections" notice', () => {
    const ctx = makeContext({ motivations: [] });
    const result = generateReviewPrompt(ctx, { diffOnly: false, intent: true });
    expect(result).toContain('No motivation sections found');
  });

  it('intent=true diffOnly=true still includes motivations', () => {
    const ctx = makeContext({ motivations: ['The reason this feature exists'] });
    const result = generateReviewPrompt(ctx, { diffOnly: true, intent: true });
    expect(result).toContain('The reason this feature exists');
    expect(result).toContain('Problem Context');
  });
});
