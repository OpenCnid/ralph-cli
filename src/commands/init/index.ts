import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { findProjectRoot } from '../../config/loader.js';
import { ensureDir, safeWriteFile, success, warn, info, plain } from '../../utils/index.js';
import { detectProject } from './detect.js';
import * as templates from './templates.js';
import * as prompt from '../../utils/prompt.js';

interface InitOptions {
  defaults?: boolean | undefined;
}

interface FileEntry {
  path: string;
  content: string;
}

const LANGUAGE_OPTIONS = ['typescript', 'javascript', 'python', 'go', 'rust'] as const;
const FRAMEWORK_OPTIONS = ['nextjs', 'express', 'fastify', 'react', 'none'] as const;

function summaryForDetection(
  detection: ReturnType<typeof detectProject>,
): string {
  return `${detection.language}${detection.framework ? ` + ${detection.framework}` : ''}`;
}

function defaultLanguageIndex(language: string): number {
  const idx = LANGUAGE_OPTIONS.indexOf(language as (typeof LANGUAGE_OPTIONS)[number]);
  return idx >= 0 ? idx : 0;
}

function defaultFrameworkIndex(framework: string | undefined): number {
  if (!framework) return FRAMEWORK_OPTIONS.indexOf('none');
  const idx = FRAMEWORK_OPTIONS.indexOf(framework as (typeof FRAMEWORK_OPTIONS)[number]);
  return idx >= 0 ? idx : FRAMEWORK_OPTIONS.indexOf('none');
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

export async function initCommand(options: InitOptions): Promise<void> {
  const projectRoot = findProjectRoot(process.cwd());
  const detection = detectProject(projectRoot);
  let projectName = detection.projectName ?? 'my-project';
  const interactive = !options.defaults && process.stdin.isTTY === true;

  info(`Detected: ${summaryForDetection(detection)}`);

  if (interactive) {
    projectName = await prompt.ask('Project name', projectName);
    const description = await prompt.ask('Description', detection.description ?? '');
    detection.description = description;

    const acceptedDetected = await prompt.confirm('Accept detected language and framework?', true);
    if (!acceptedDetected) {
      const selectedLanguage = await prompt.select(
        'Language',
        [...LANGUAGE_OPTIONS],
        defaultLanguageIndex(detection.language),
      );
      const selectedFramework = await prompt.select(
        'Framework',
        [...FRAMEWORK_OPTIONS],
        defaultFrameworkIndex(detection.framework),
      );

      detection.language = selectedLanguage as (typeof LANGUAGE_OPTIONS)[number];
      detection.framework = selectedFramework === 'none' ? undefined : selectedFramework;
    }
  }

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

  plain('');
  info(`Done: ${created} created, ${skipped} skipped`);
  if (created > 0) {
    info('Review generated files and customize for your project.');
  }
}
