import { existsSync, readFileSync, appendFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { loadConfig, findProjectRoot } from '../../config/index.js';
import { ensureDir, safeWriteFile, safeReadFile } from '../../utils/fs.js';
import { success, warn, error, info } from '../../utils/index.js';

function today(): string {
  return new Date().toISOString().split('T')[0]!;
}

export function promoteDocCommand(principle: string, options: { to?: string }): void {
  const projectRoot = findProjectRoot(process.cwd());
  const { config } = loadConfig(projectRoot);

  const targetDoc = options.to ?? 'core-beliefs.md';
  let targetPath: string;

  if (targetDoc === 'core-beliefs.md') {
    targetPath = join(projectRoot, config.paths['design-docs'], 'core-beliefs.md');
  } else {
    targetPath = join(projectRoot, config.paths.docs, targetDoc);
  }

  if (!existsSync(targetPath)) {
    error(`Target document not found: ${targetPath}`);
    info(`Run \`ralph init\` to create the standard doc structure.`);
    process.exit(1);
  }

  const trimmedPrinciple = principle.endsWith('.') ? principle.slice(0, -1) : principle;
  const entry = `\n- **${trimmedPrinciple}.** Added ${today()}.\n`;
  appendFileSync(targetPath, entry);
  success(`Promoted to ${targetDoc}: "${principle}"`);
}

export function promoteLintCommand(
  ruleName: string,
  options: { description?: string; pattern?: string; require?: string; fix?: string }
): void {
  const projectRoot = findProjectRoot(process.cwd());
  const rulesDir = join(projectRoot, '.ralph', 'rules');
  ensureDir(rulesDir);

  if (!options.pattern) {
    error('--pattern is required for lint rules');
    process.exit(1);
  }
  if (!options.fix) {
    error('--fix is required for lint rules');
    process.exit(1);
  }

  const filename = `${ruleName}.yml`;
  const filePath = join(rulesDir, filename);

  if (existsSync(filePath)) {
    error(`Rule already exists: .ralph/rules/${filename}`);
    process.exit(1);
  }

  let content = `name: ${ruleName}\n`;
  content += `description: ${options.description ?? ruleName}\n`;
  content += `severity: error\n`;
  content += `match:\n`;
  content += `  pattern: '${options.pattern}'\n`;
  if (options.require) {
    content += `  require-nearby: '${options.require}'\n`;
    content += `  within-lines: 5\n`;
  }
  content += `fix: ${options.fix}\n`;

  safeWriteFile(filePath, content);
  success(`Created lint rule: .ralph/rules/${filename}`);
}

export function promotePatternCommand(name: string, options: { description?: string }): void {
  const projectRoot = findProjectRoot(process.cwd());
  const { config } = loadConfig(projectRoot);
  const designDocsDir = join(projectRoot, config.paths['design-docs']);
  ensureDir(designDocsDir);

  const filename = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`;
  const filePath = join(designDocsDir, filename);

  if (existsSync(filePath)) {
    error(`Design doc already exists: ${filename}`);
    process.exit(1);
  }

  const content = `# ${name}

Created: ${today()}
Status: Draft

## Description

${options.description ?? 'Describe the pattern and when to use it.'}

## When to Use

## Examples

## Trade-offs
`;

  safeWriteFile(filePath, content);
  success(`Created design doc: ${config.paths['design-docs']}/${filename}`);

  // Update design-docs/index.md
  const indexPath = join(designDocsDir, 'index.md');
  if (existsSync(indexPath)) {
    const indexContent = readFileSync(indexPath, 'utf-8');
    const entry = `| [${filename}](${filename}) | Draft | ${options.description ?? name} |\n`;
    // Insert before the "## Adding" section if it exists
    const addingIdx = indexContent.indexOf('## Adding');
    if (addingIdx !== -1) {
      const updated = indexContent.slice(0, addingIdx) + entry + indexContent.slice(addingIdx);
      safeWriteFile(indexPath, updated);
    } else {
      appendFileSync(indexPath, entry);
    }
  }
}

export function promoteListCommand(): void {
  const projectRoot = findProjectRoot(process.cwd());
  const { config } = loadConfig(projectRoot);

  info('Taste Rules:');
  console.log('');

  // Doc-level: core-beliefs.md entries
  const beliefsPath = join(projectRoot, config.paths['design-docs'], 'core-beliefs.md');
  if (existsSync(beliefsPath)) {
    const content = readFileSync(beliefsPath, 'utf-8');
    const entries = content.match(/^\d+\.\s+.+$/gm) ?? [];
    const dated = content.match(/^- \*\*.+?\.\*\*\s+Added\s+\d{4}-\d{2}-\d{2}\.$/gm) ?? [];
    // Also match legacy format: - **date** — principle
    const datedLegacy = content.match(/^- \*\*\d{4}-\d{2}-\d{2}\*\* — .+$/gm) ?? [];
    if (entries.length > 0 || dated.length > 0) {
      info('Documentation (core-beliefs.md):');
      for (const e of entries) console.log(`  ○ ${e.trim()}`);
      for (const e of dated) console.log(`  ○ ${e.replace(/^- /, '').trim()}`);
      for (const e of datedLegacy) console.log(`  ○ ${e.replace(/^- /, '').trim()}`);
    }
  }

  // Lint-level: .ralph/rules/*.yml
  const rulesDir = join(projectRoot, '.ralph', 'rules');
  if (existsSync(rulesDir)) {
    const ruleFiles = readdirSync(rulesDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
    if (ruleFiles.length > 0) {
      console.log('');
      info('Lint Rules (.ralph/rules/):');
      for (const file of ruleFiles) {
        const content = safeReadFile(join(rulesDir, file)) ?? '';
        const nameMatch = content.match(/^name:\s*(.+)$/m);
        const descMatch = content.match(/^description:\s*(.+)$/m);
        const name = nameMatch?.[1] ?? file;
        const desc = descMatch?.[1] ?? '';
        console.log(`  ✓ ${name} — ${desc} (${file})`);
      }
    }
  }

  // Pattern-level: design docs
  const designDocsDir = join(projectRoot, config.paths['design-docs']);
  if (existsSync(designDocsDir)) {
    const docs = readdirSync(designDocsDir).filter(f => f.endsWith('.md') && f !== 'index.md' && f !== 'core-beliefs.md');
    if (docs.length > 0) {
      console.log('');
      info('Patterns (design docs):');
      for (const doc of docs) {
        const content = safeReadFile(join(designDocsDir, doc)) ?? '';
        const titleMatch = content.match(/^# (.+)$/m);
        const title = titleMatch?.[1] ?? doc;
        console.log(`  ○ ${title} (${doc})`);
      }
    }
  }
}
