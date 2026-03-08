import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { findProjectRoot } from '../../config/loader.js';
import { ensureDir, safeWriteFile, success, warn, info } from '../../utils/index.js';
import { detectProject } from './detect.js';
import * as templates from './templates.js';

interface InitOptions {
  defaults?: boolean | undefined;
}

interface FileEntry {
  path: string;
  content: string;
}

function buildFileList(projectName: string, detection: ReturnType<typeof detectProject>): FileEntry[] {
  return [
    { path: 'AGENTS.md', content: templates.agentsMd(projectName, detection) },
    { path: 'ARCHITECTURE.md', content: templates.architectureMd(projectName) },
    { path: 'docs/DESIGN.md', content: templates.designMd() },
    { path: 'docs/RELIABILITY.md', content: templates.reliabilityMd() },
    { path: 'docs/SECURITY.md', content: templates.securityMd() },
    { path: 'docs/PLANS.md', content: templates.plansMd() },
    { path: 'docs/QUALITY_SCORE.md', content: templates.qualityScoreMd() },
    { path: 'docs/design-docs/index.md', content: templates.designDocsIndexMd() },
    { path: 'docs/design-docs/core-beliefs.md', content: templates.coreBeliefsMd() },
    { path: 'docs/product-specs/index.md', content: templates.productSpecsIndexMd() },
    { path: 'docs/exec-plans/index.md', content: templates.execPlansIndexMd() },
    { path: 'docs/exec-plans/tech-debt-tracker.md', content: templates.techDebtTrackerMd() },
    { path: 'docs/generated/.gitkeep', content: '' },
    { path: 'docs/references/.gitkeep', content: '' },
    { path: '.ralph/config.yml', content: templates.configYml(projectName, detection) },
    { path: '.ralph/rules/.gitkeep', content: '' },
  ];
}

export function initCommand(options: InitOptions): void {
  const projectRoot = findProjectRoot(process.cwd());
  const detection = detectProject(projectRoot);
  const projectName = detection.projectName ?? 'my-project';

  info(`Detected: ${detection.language}${detection.framework ? ` + ${detection.framework}` : ''}`);

  // Ensure directories exist
  const dirs = [
    'docs/design-docs',
    'docs/design-docs/patterns',
    'docs/exec-plans/active',
    'docs/exec-plans/completed',
    'docs/product-specs',
    'docs/generated',
    'docs/references',
    '.ralph/rules',
  ];

  for (const dir of dirs) {
    ensureDir(join(projectRoot, dir));
  }

  const files = buildFileList(projectName, detection);
  let created = 0;
  let skipped = 0;

  for (const file of files) {
    const fullPath = join(projectRoot, file.path);
    if (existsSync(fullPath)) {
      warn(`Skipped (exists): ${file.path}`);
      skipped++;
    } else {
      safeWriteFile(fullPath, file.content);
      success(`Created: ${file.path}`);
      created++;
    }
  }

  console.log('');
  info(`Done: ${created} created, ${skipped} skipped`);
  if (created > 0) {
    info('Review generated files and customize for your project.');
  }
}
