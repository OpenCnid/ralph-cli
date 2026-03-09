import type { Check } from './checks.js';

export function calculateScore(checks: Check[]): number {
  const total = checks.length;
  if (total === 0) return 0;
  const passed = checks.filter(c => c.pass).length;
  return Math.round((passed / total) * 10);
}

export function scoreLabel(score: number): string {
  if (score === 10) return 'Excellent';
  if (score >= 7) return 'Good';
  if (score >= 4) return 'Fair';
  if (score >= 1) return 'Poor';
  return 'Not Ready';
}
