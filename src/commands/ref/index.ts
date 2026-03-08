import { existsSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { loadConfig, findProjectRoot } from '../../config/index.js';
import { ensureDir, safeWriteFile, safeReadFile } from '../../utils/fs.js';
import { success, warn, error, info } from '../../utils/index.js';
import { ask } from '../../utils/prompt.js';

function today(): string {
  return new Date().toISOString().split('T')[0]!;
}

function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export async function refAddCommand(urlOrPath: string, options: { name?: string }): Promise<void> {
  const projectRoot = findProjectRoot(process.cwd());
  const { config } = loadConfig(projectRoot);
  const refsDir = join(projectRoot, config.paths.references);
  ensureDir(refsDir);

  let content: string;
  let sourceName: string;
  let isUrl = false;

  if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://')) {
    isUrl = true;
    try {
      const response = await fetch(urlOrPath);
      if (!response.ok) {
        error(`Failed to fetch ${urlOrPath}: ${response.status} ${response.statusText}`);
        process.exit(1);
      }
      content = await response.text();
    } catch (err) {
      error(`Failed to fetch ${urlOrPath}: ${(err as Error).message}`);
      process.exit(1);
    }
    // Extract name from URL domain
    try {
      const url = new URL(urlOrPath);
      sourceName = url.hostname.replace('www.', '').split('.')[0] ?? 'reference';
    } catch {
      sourceName = 'reference';
    }
  } else {
    // Local file
    const fullPath = join(projectRoot, urlOrPath);
    if (!existsSync(fullPath)) {
      error(`File not found: ${urlOrPath}`);
      process.exit(1);
    }
    content = readFileSync(fullPath, 'utf-8');
    const ext = urlOrPath.endsWith('.md') ? '.md' : '.txt';
    sourceName = basename(urlOrPath, ext).replace(/-llms$/, '');
  }

  // Determine suffix based on source file extension or URL path
  const isMd = urlOrPath.endsWith('.md') || urlOrPath.endsWith('-llms.md');
  const suffix = isMd ? '-llms.md' : '-llms.txt';
  const name = options.name ?? sanitizeName(sourceName);
  const filename = `${name}${suffix}`;
  const filePath = join(refsDir, filename);

  // Add metadata comment
  const metadata = `<!-- ralph-ref: source=${urlOrPath} fetched=${today()} -->\n`;
  safeWriteFile(filePath, metadata + content);

  const sizeKb = Math.round(Buffer.byteLength(metadata + content) / 1024);
  success(`Added reference: ${filename} (${sizeKb}KB)`);

  // Check size warnings
  checkSizeWarnings(refsDir, config.references['max-total-kb'], config.references['warn-single-file-kb']);
}

export function refListCommand(options: { sizes?: boolean }): void {
  const projectRoot = findProjectRoot(process.cwd());
  const { config } = loadConfig(projectRoot);
  const refsDir = join(projectRoot, config.paths.references);

  if (!existsSync(refsDir)) {
    info('No references directory found. Run `ralph init` first.');
    return;
  }

  const files = readdirSync(refsDir).filter(f => !f.startsWith('.'));
  if (files.length === 0) {
    info('No references found. Add one with `ralph ref add <url-or-path>`.');
    return;
  }

  let totalKb = 0;
  const entries: { name: string; sizeKb: number; source: string; date: string }[] = [];

  for (const file of files) {
    const filePath = join(refsDir, file);
    const stat = statSync(filePath);
    const sizeKb = Math.round(stat.size / 1024);
    totalKb += sizeKb;

    let source = '';
    let date = '';
    const content = safeReadFile(filePath);
    if (content) {
      const metaMatch = content.match(/<!-- ralph-ref: source=(\S+) fetched=(\S+) -->/);
      if (metaMatch) {
        source = metaMatch[1] ?? '';
        date = metaMatch[2] ?? '';
      }
    }

    entries.push({ name: file, sizeKb, source, date });
  }

  info(`References (${entries.length} files, ${totalKb}KB total):`);
  console.log('');

  if (options.sizes) {
    const maxKb = config.references['max-total-kb'];
    for (const e of entries) {
      const bar = '█'.repeat(Math.max(1, Math.round((e.sizeKb / maxKb) * 40)));
      const pct = maxKb > 0 ? Math.round((e.sizeKb / maxKb) * 100) : 0;
      console.log(`  ${e.name.padEnd(40)} ${String(e.sizeKb).padStart(4)}KB ${bar} ${pct}%`);
    }
    console.log('');
    console.log(`  Total: ${totalKb}KB / ${maxKb}KB (${Math.round((totalKb / maxKb) * 100)}%)`);
  } else {
    for (const e of entries) {
      console.log(`  ${e.name} (${e.sizeKb}KB${e.date ? `, added ${e.date}` : ''})`);
      if (e.source) console.log(`    Source: ${e.source}`);
    }
  }

  checkSizeWarnings(refsDir, config.references['max-total-kb'], config.references['warn-single-file-kb']);
}

export async function refUpdateCommand(name?: string): Promise<void> {
  const projectRoot = findProjectRoot(process.cwd());
  const { config } = loadConfig(projectRoot);
  const refsDir = join(projectRoot, config.paths.references);

  if (!existsSync(refsDir)) {
    error('No references directory found.');
    return;
  }

  const files = name
    ? [readdirSync(refsDir).find(f => f.includes(name))]
    : readdirSync(refsDir).filter(f => f.endsWith('.txt') || f.endsWith('.md'));

  let updated = 0;
  for (const file of files) {
    if (!file) continue;
    const filePath = join(refsDir, file);
    const content = safeReadFile(filePath);
    if (!content) continue;

    const metaMatch = content.match(/<!-- ralph-ref: source=(\S+) fetched=\S+ -->/);
    if (!metaMatch?.[1] || !metaMatch[1].startsWith('http')) continue;

    try {
      const response = await fetch(metaMatch[1]);
      if (!response.ok) {
        warn(`Failed to update ${file}: ${response.status}`);
        continue;
      }
      const newContent = await response.text();
      const metadata = `<!-- ralph-ref: source=${metaMatch[1]} fetched=${today()} -->\n`;
      safeWriteFile(filePath, metadata + newContent);
      success(`Updated: ${file}`);
      updated++;
    } catch (err) {
      warn(`Failed to update ${file}: ${(err as Error).message}`);
    }
  }

  if (updated === 0) {
    info('No references were updated.');
  }
}

interface DiscoveredRef {
  name: string;
  url: string;
}

function extractDependencies(projectRoot: string): string[] {
  const deps: string[] = [];

  // package.json (Node.js)
  const pkgPath = join(projectRoot, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
      const allDeps = {
        ...(pkg['dependencies'] as Record<string, string> | undefined),
        ...(pkg['devDependencies'] as Record<string, string> | undefined),
      };
      deps.push(...Object.keys(allDeps));
    } catch { /* ignore */ }
  }

  // pyproject.toml (Python) — basic extraction
  const pyPath = join(projectRoot, 'pyproject.toml');
  if (existsSync(pyPath)) {
    try {
      const content = readFileSync(pyPath, 'utf-8');
      const depMatches = content.matchAll(/^\s*"([a-zA-Z0-9_-]+)/gm);
      for (const m of depMatches) {
        if (m[1]) deps.push(m[1]);
      }
    } catch { /* ignore */ }
  }

  // go.mod (Go)
  const goPath = join(projectRoot, 'go.mod');
  if (existsSync(goPath)) {
    try {
      const content = readFileSync(goPath, 'utf-8');
      const reqMatches = content.matchAll(/^\s+([\w./:-]+)\s+v/gm);
      for (const m of reqMatches) {
        if (m[1]) deps.push(m[1]);
      }
    } catch { /* ignore */ }
  }

  return deps;
}

function depToUrls(dep: string): string[] {
  const urls: string[] = [];

  // npm scoped packages: @scope/name -> name
  const cleanName = dep.startsWith('@') ? dep.split('/')[1] ?? dep : dep;

  // Common llms.txt URL patterns
  urls.push(`https://docs.${cleanName}.dev/llms.txt`);
  urls.push(`https://${cleanName}.dev/llms.txt`);
  urls.push(`https://docs.${cleanName}.com/llms.txt`);
  urls.push(`https://${cleanName}.com/llms.txt`);

  // Go modules: use the module path directly
  if (dep.includes('/')) {
    const host = dep.split('/').slice(0, 2).join('/');
    urls.push(`https://${host}/llms.txt`);
  }

  return urls;
}

export async function refDiscoverCommand(): Promise<void> {
  const projectRoot = findProjectRoot(process.cwd());
  const deps = extractDependencies(projectRoot);

  if (deps.length === 0) {
    info('No dependencies found. Ensure package.json, pyproject.toml, or go.mod exists.');
    return;
  }

  info(`Scanning ${deps.length} dependencies for llms.txt files...`);

  const discovered: DiscoveredRef[] = [];
  const checked = new Set<string>();

  for (const dep of deps) {
    const urls = depToUrls(dep);
    for (const url of urls) {
      if (checked.has(url)) continue;
      checked.add(url);

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(url, {
          method: 'HEAD',
          signal: controller.signal,
          redirect: 'follow',
        });
        clearTimeout(timeout);

        if (response.ok) {
          const cleanName = dep.startsWith('@') ? dep.split('/')[1] ?? dep : dep;
          discovered.push({ name: sanitizeName(cleanName), url });
          break; // Found one URL for this dep, skip others
        }
      } catch {
        // Network error or timeout — skip
      }
    }
  }

  if (discovered.length === 0) {
    info('No llms.txt files found for project dependencies.');
    return;
  }

  success(`Found ${discovered.length} available reference(s):`);
  console.log('');
  for (const ref of discovered) {
    console.log(`  ${ref.name}: ${ref.url}`);
  }
  console.log('');

  if (process.stdin.isTTY === true) {
    const answer = await ask('Add references? (numbers like "1,3", "a" for all, Enter to skip)', '');
    if (answer.trim().toLowerCase() === 'a') {
      for (const ref of discovered) {
        await refAddCommand(ref.url, { name: ref.name });
      }
      return;
    }

    if (answer.trim()) {
      const indices = answer
        .split(/[,\s]+/)
        .map(n => Number.parseInt(n, 10) - 1)
        .filter(i => !Number.isNaN(i));
      for (const idx of indices) {
        if (idx >= 0 && idx < discovered.length) {
          const ref = discovered[idx]!;
          await refAddCommand(ref.url, { name: ref.name });
        }
      }
      return;
    }
  }

  info('Add with: ralph ref add <url> --name <name>');
}

export function refRemoveCommand(name: string): void {
  const projectRoot = findProjectRoot(process.cwd());
  const { config } = loadConfig(projectRoot);
  const refsDir = join(projectRoot, config.paths.references);

  const file = readdirSync(refsDir).find(f => f.includes(name));
  if (!file) {
    error(`Reference not found: ${name}`);
    process.exit(1);
  }

  unlinkSync(join(refsDir, file));
  success(`Removed: ${file}`);
}

function checkSizeWarnings(refsDir: string, maxTotalKb: number, warnSingleKb: number): void {
  let totalKb = 0;
  const files = readdirSync(refsDir).filter(f => !f.startsWith('.'));

  for (const file of files) {
    const stat = statSync(join(refsDir, file));
    const sizeKb = Math.round(stat.size / 1024);
    totalKb += sizeKb;

    if (sizeKb > warnSingleKb) {
      warn(`${file} is ${sizeKb}KB (warning threshold: ${warnSingleKb}KB)`);
    }
  }

  if (totalKb > maxTotalKb) {
    warn(`Total references size ${totalKb}KB exceeds limit of ${maxTotalKb}KB`);
  }
}
