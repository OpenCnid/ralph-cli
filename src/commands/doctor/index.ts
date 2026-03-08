import { loadConfig, findProjectRoot } from '../../config/index.js';
import { success, warn, error, info, heading, plain } from '../../utils/index.js';
import * as prompt from '../../utils/prompt.js';
import { runAllChecks, calculateScore, scoreLabel } from './checks.js';
import type { Check } from './checks.js';

export type { Check } from './checks.js';
export { runAllChecks } from './checks.js';

interface DoctorOptions {
  json?: boolean | undefined;
  ci?: boolean | undefined;
  fix?: boolean | undefined;
}

export async function doctorCommand(options: DoctorOptions): Promise<void> {
  const projectRoot = findProjectRoot(process.cwd());
  const { config, warnings } = loadConfig(projectRoot, options.ci);

  if (!options.json) {
    for (const w of warnings) warn(w);
  }

  const checks = runAllChecks(projectRoot, config);
  const score = calculateScore(checks);

  if (options.json) {
    plain(JSON.stringify({
      score,
      label: scoreLabel(score),
      checks: checks.map(c => ({
        name: c.name,
        category: c.category,
        pass: c.pass,
        detail: c.detail,
        fix: c.fix,
      })),
    }, null, 2));
    if (options.ci && score < config.doctor['minimum-score']) {
      process.exit(1);
    }
    return;
  }

  // Group by category with category-level status
  const categories = ['structure', 'content', 'backpressure', 'operational'] as const;
  const failingChecks: Check[] = [];

  for (const cat of categories) {
    const catChecks = checks.filter(c => c.category === cat);
    if (catChecks.length === 0) continue;

    const allPass = catChecks.every(c => c.pass);
    const catLabel = cat.charAt(0).toUpperCase() + cat.slice(1);

    plain('');
    heading(`${allPass ? '\u2705' : '\u26A0\uFE0F '} ${catLabel}`);
    for (const check of catChecks) {
      if (check.pass) {
        success(`${check.name} — ${check.detail}`);
      } else {
        error(`${check.name} — ${check.detail}`);
        if (check.fix) {
          plain(`    Fix: ${check.fix}`);
        }
        failingChecks.push(check);
      }
    }
  }

  plain('');
  const passed = checks.filter(c => c.pass).length;
  info(`Score: ${score}/10 (${scoreLabel(score)}) — ${passed}/${checks.length} checks passed`);

  // Fix summary with target score label
  if (failingChecks.length > 0) {
    plain('');
    // Calculate potential score if all failing checks were fixed
    const potentialScore = calculateScore(checks.map(c => ({ ...c, pass: true })));
    const targetLabel = scoreLabel(potentialScore);
    info(`Fix ${failingChecks.length} issue(s) to reach ${targetLabel}:`);
    failingChecks.forEach((c, i) => {
      if (c.fix) {
        plain(`  ${i + 1}. ${c.fix}`);
      }
    });
  }

  if (options.ci && score < config.doctor['minimum-score']) {
    error(`Score ${score} is below minimum ${config.doctor['minimum-score']}`);
    process.exit(1);
  }

  if (options.fix) {
    const fixable = checks.filter(c => !c.pass && c.fix?.includes('ralph init'));
    if (fixable.length > 0) {
      plain('');
      info('Fixable issues:');
      for (const check of fixable) {
        plain(`  • ${check.name}`);
      }

      const proceed = process.stdin.isTTY === true
        ? await prompt.confirm(`Fix ${fixable.length} issue(s)?`, true)
        : true;

      if (proceed) {
        try {
          const { initCommand } = await import('../init/index.js');
          await initCommand({ defaults: true });
        } catch {
          error('Failed to run ralph init');
        }
      }
    }
  }
}
