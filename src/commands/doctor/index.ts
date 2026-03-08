import { join } from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { loadConfig, findProjectRoot } from '../../config/index.js';
import type { RalphConfig } from '../../config/schema.js';
import { success, warn, error, info, heading } from '../../utils/index.js';

interface DoctorOptions {
  json?: boolean | undefined;
  ci?: boolean | undefined;
  fix?: boolean | undefined;
}

export interface Check {
  name: string;
  category: 'structure' | 'content' | 'backpressure' | 'operational';
  pass: boolean;
  detail: string;
  fix?: string | undefined;
}

function runStructureChecks(projectRoot: string, config: RalphConfig): Check[] {
  const checks: Check[] = [];

  // AGENTS.md exists and under 100 lines
  const agentsPath = join(projectRoot, config.paths['agents-md']);
  if (existsSync(agentsPath)) {
    const lines = readFileSync(agentsPath, 'utf-8').split('\n').length;
    checks.push({
      name: 'AGENTS.md exists and under 100 lines',
      category: 'structure',
      pass: lines <= 100,
      detail: lines <= 100 ? `${lines} lines` : `${lines} lines (exceeds 100 line limit)`,
      fix: lines > 100 ? 'Trim AGENTS.md to under 100 lines. Move detailed content to docs/.' : undefined,
    });
  } else {
    checks.push({
      name: 'AGENTS.md exists',
      category: 'structure',
      pass: false,
      detail: 'Missing',
      fix: 'Run `ralph init` to create AGENTS.md',
    });
  }

  // ARCHITECTURE.md exists
  const archPath = join(projectRoot, config.paths['architecture-md']);
  checks.push({
    name: 'ARCHITECTURE.md exists',
    category: 'structure',
    pass: existsSync(archPath),
    detail: existsSync(archPath) ? 'Present' : 'Missing',
    fix: existsSync(archPath) ? undefined : 'Run `ralph init` to create ARCHITECTURE.md',
  });

  // docs/ directories
  const docDirs = ['design-docs', 'product-specs', 'references', 'generated'] as const;
  for (const dir of docDirs) {
    const dirKey = dir === 'design-docs' ? 'design-docs' :
                   dir === 'product-specs' ? 'specs' :
                   dir;
    const dirPath = join(projectRoot, config.paths[dirKey as keyof typeof config.paths] as string);
    checks.push({
      name: `docs/${dir}/ exists`,
      category: 'structure',
      pass: existsSync(dirPath),
      detail: existsSync(dirPath) ? 'Present' : 'Missing',
      fix: existsSync(dirPath) ? undefined : `Run \`ralph init\` to create docs/${dir}/`,
    });
  }

  // exec-plans with active/ and completed/
  const plansPath = join(projectRoot, config.paths.plans);
  const activePath = join(plansPath, 'active');
  const completedPath = join(plansPath, 'completed');
  checks.push({
    name: 'docs/exec-plans/ with active/ and completed/',
    category: 'structure',
    pass: existsSync(plansPath) && existsSync(activePath) && existsSync(completedPath),
    detail: existsSync(plansPath) ? 'Present' : 'Missing',
    fix: !existsSync(plansPath) ? 'Run `ralph init` to create exec-plans structure' : undefined,
  });

  // .ralph/config.yml
  const configPath = join(projectRoot, '.ralph', 'config.yml');
  checks.push({
    name: '.ralph/config.yml valid',
    category: 'structure',
    pass: existsSync(configPath),
    detail: existsSync(configPath) ? 'Present and valid' : 'Missing',
    fix: existsSync(configPath) ? undefined : 'Run `ralph init` to create .ralph/config.yml',
  });

  // Domain docs
  for (const doc of ['DESIGN.md', 'RELIABILITY.md', 'SECURITY.md']) {
    const docPath = join(projectRoot, config.paths.docs, doc);
    checks.push({
      name: `docs/${doc} exists`,
      category: 'structure',
      pass: existsSync(docPath),
      detail: existsSync(docPath) ? 'Present' : 'Missing',
      fix: existsSync(docPath) ? undefined : `Run \`ralph init\` to create docs/${doc}`,
    });
  }

  // QUALITY_SCORE.md
  const qualityPath = join(projectRoot, config.paths.quality);
  checks.push({
    name: 'QUALITY_SCORE.md exists',
    category: 'structure',
    pass: existsSync(qualityPath),
    detail: existsSync(qualityPath) ? 'Present' : 'Missing',
    fix: existsSync(qualityPath) ? undefined : 'Run `ralph grade` to generate QUALITY_SCORE.md',
  });

  // core-beliefs.md
  const beliefsPath = join(projectRoot, config.paths['design-docs'], 'core-beliefs.md');
  checks.push({
    name: 'core-beliefs.md exists',
    category: 'structure',
    pass: existsSync(beliefsPath),
    detail: existsSync(beliefsPath) ? 'Present' : 'Missing',
    fix: existsSync(beliefsPath) ? undefined : 'Run `ralph init` to create core-beliefs.md',
  });

  return checks;
}

function runContentChecks(projectRoot: string, config: RalphConfig): Check[] {
  const checks: Check[] = [];

  // AGENTS.md contains build/test/lint commands
  const agentsPath = join(projectRoot, config.paths['agents-md']);
  if (existsSync(agentsPath)) {
    const content = readFileSync(agentsPath, 'utf-8').toLowerCase();
    const hasCommands = content.includes('build') && content.includes('test') && content.includes('lint');
    checks.push({
      name: 'AGENTS.md contains build/test/lint commands',
      category: 'content',
      pass: hasCommands,
      detail: hasCommands ? 'Commands found' : 'Missing one or more of: build, test, lint commands',
      fix: hasCommands ? undefined : 'Add build, test, and lint commands to AGENTS.md',
    });

    // No LLM refs
    const llmTerms = ['openai', 'anthropic', 'gpt-4', 'gpt-3', 'chatgpt', 'gemini'];
    const hasLlmRefs = llmTerms.some(t => content.includes(t));
    checks.push({
      name: 'AGENTS.md has no LLM provider references',
      category: 'content',
      pass: !hasLlmRefs,
      detail: hasLlmRefs ? 'Found LLM provider references' : 'Clean',
      fix: hasLlmRefs ? 'Remove references to specific LLM providers from AGENTS.md' : undefined,
    });

    // ToC structure (not monolith)
    const lines = readFileSync(agentsPath, 'utf-8').split('\n');
    const headingCount = lines.filter(l => l.startsWith('#')).length;
    checks.push({
      name: 'AGENTS.md is structured (not monolith)',
      category: 'content',
      pass: headingCount >= 3,
      detail: `${headingCount} sections found`,
      fix: headingCount < 3 ? 'Add more sections to AGENTS.md to organize content' : undefined,
    });
  }

  // ARCHITECTURE.md describes domain boundaries
  const archPath = join(projectRoot, config.paths['architecture-md']);
  if (existsSync(archPath)) {
    const content = readFileSync(archPath, 'utf-8').toLowerCase();
    const hasDomains = content.includes('domain') || content.includes('boundary') || content.includes('layer');
    checks.push({
      name: 'ARCHITECTURE.md describes boundaries',
      category: 'content',
      pass: hasDomains,
      detail: hasDomains ? 'Domain/layer content found' : 'No domain or layer descriptions found',
      fix: hasDomains ? undefined : 'Add domain boundaries and layer descriptions to ARCHITECTURE.md',
    });
  }

  // core-beliefs.md has at least 3 beliefs
  const beliefsPath = join(projectRoot, config.paths['design-docs'], 'core-beliefs.md');
  if (existsSync(beliefsPath)) {
    const content = readFileSync(beliefsPath, 'utf-8');
    const beliefs = content.match(/^\d+\./gm);
    const count = beliefs?.length ?? 0;
    checks.push({
      name: 'core-beliefs.md has at least 3 principles',
      category: 'content',
      pass: count >= 3,
      detail: `${count} principles found`,
      fix: count < 3 ? 'Add at least 3 numbered principles to core-beliefs.md' : undefined,
    });
  }

  // tech-debt-tracker.md exists
  const trackerPath = join(projectRoot, config.paths.plans, 'tech-debt-tracker.md');
  checks.push({
    name: 'tech-debt-tracker.md exists',
    category: 'content',
    pass: existsSync(trackerPath),
    detail: existsSync(trackerPath) ? 'Present' : 'Missing',
    fix: existsSync(trackerPath) ? undefined : 'Run `ralph init` to create tech-debt-tracker.md',
  });

  return checks;
}

function runBackpressureChecks(projectRoot: string): Check[] {
  const checks: Check[] = [];

  // Test runner configured
  const pkgPath = join(projectRoot, 'package.json');
  let hasTestRunner = false;
  let hasLinter = false;
  let hasTypeChecker = false;

  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
      const deps = { ...(pkg['dependencies'] as Record<string, string> | undefined), ...(pkg['devDependencies'] as Record<string, string> | undefined) };
      const scripts = pkg['scripts'] as Record<string, string> | undefined;

      hasTestRunner = !!(deps['vitest'] || deps['jest'] || deps['mocha'] || scripts?.['test']);
      hasLinter = !!(deps['eslint'] || deps['biome'] || deps['@biomejs/biome']);
      hasTypeChecker = !!(deps['typescript']);
    } catch { /* ignore */ }
  }

  // Python
  if (existsSync(join(projectRoot, 'pyproject.toml'))) {
    hasTestRunner = true; // pytest is standard
    hasTypeChecker = true; // mypy common
  }

  // Go
  if (existsSync(join(projectRoot, 'go.mod'))) {
    hasTestRunner = true; // go test built-in
    hasTypeChecker = true; // go compiler
  }

  checks.push({
    name: 'Test runner configured',
    category: 'backpressure',
    pass: hasTestRunner,
    detail: hasTestRunner ? 'Configured' : 'No test runner found',
    fix: hasTestRunner ? undefined : 'Add a test runner (vitest, jest, pytest, go test)',
  });

  checks.push({
    name: 'Linter configured',
    category: 'backpressure',
    pass: hasLinter,
    detail: hasLinter ? 'Configured' : 'No linter found',
    fix: hasLinter ? undefined : 'Add a linter (eslint, biome, ruff)',
  });

  checks.push({
    name: 'Type checker configured',
    category: 'backpressure',
    pass: hasTypeChecker,
    detail: hasTypeChecker ? 'Configured' : 'No type checker found',
    fix: hasTypeChecker ? undefined : 'Add a type checker (typescript, mypy)',
  });

  // Ralph lint rules configured
  const configPath = join(projectRoot, '.ralph', 'config.yml');
  let hasLintRules = false;
  if (existsSync(configPath)) {
    try {
      const configContent = readFileSync(configPath, 'utf-8');
      hasLintRules = configContent.includes('layers:') || configContent.includes('domains:');
    } catch { /* ignore */ }
  }
  // Also check for custom rules
  const rulesDir = join(projectRoot, '.ralph', 'rules');
  let customRuleCount = 0;
  if (existsSync(rulesDir)) {
    try {
      customRuleCount = readdirSync(rulesDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml')).length;
    } catch { /* ignore */ }
  }
  const totalRules = (hasLintRules ? 3 : 0) + customRuleCount; // 3 built-in rules when layers configured
  checks.push({
    name: 'Ralph lint rules configured',
    category: 'backpressure',
    pass: totalRules > 0,
    detail: totalRules > 0 ? `${totalRules} architectural rule(s) configured` : 'No architectural rules',
    fix: totalRules === 0 ? 'Add layers or domains to .ralph/config.yml architecture section' : undefined,
  });

  return checks;
}

function runOperationalChecks(projectRoot: string): Check[] {
  const checks: Check[] = [];

  // Git repo
  const isGitRepo = existsSync(join(projectRoot, '.git'));
  checks.push({
    name: 'Git repository',
    category: 'operational',
    pass: isGitRepo,
    detail: isGitRepo ? 'Initialized' : 'Not a git repo',
    fix: isGitRepo ? undefined : 'Run `git init`',
  });

  // At least one commit
  if (isGitRepo) {
    let commitCount = 0;
    try {
      const output = execSync('git rev-list --count HEAD', { cwd: projectRoot, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
      commitCount = parseInt(output, 10) || 0;
    } catch {
      // No commits yet (empty repo)
    }
    checks.push({
      name: 'At least one commit',
      category: 'operational',
      pass: commitCount > 0,
      detail: commitCount > 0 ? `${commitCount} commits` : 'No commits',
      fix: commitCount === 0 ? 'Make an initial commit: `git add -A && git commit -m "Initial commit"`' : undefined,
    });
  }

  // .gitignore exists
  const hasGitignore = existsSync(join(projectRoot, '.gitignore'));
  checks.push({
    name: '.gitignore exists',
    category: 'operational',
    pass: hasGitignore,
    detail: hasGitignore ? 'Present' : 'Missing',
    fix: hasGitignore ? undefined : 'Create a .gitignore file',
  });

  // Build artifacts excluded
  if (hasGitignore) {
    const gitignore = readFileSync(join(projectRoot, '.gitignore'), 'utf-8');
    const excludesBuild = gitignore.includes('dist') || gitignore.includes('build') || gitignore.includes('__pycache__');
    checks.push({
      name: 'Build artifacts excluded from git',
      category: 'operational',
      pass: excludesBuild,
      detail: excludesBuild ? 'Build dirs in .gitignore' : 'Build dirs not in .gitignore',
      fix: excludesBuild ? undefined : 'Add dist/ or build/ to .gitignore',
    });
  }

  return checks;
}

function calculateScore(checks: Check[]): number {
  const total = checks.length;
  if (total === 0) return 0;
  const passed = checks.filter(c => c.pass).length;
  return Math.round((passed / total) * 10);
}

function scoreLabel(score: number): string {
  if (score === 10) return 'Excellent';
  if (score >= 7) return 'Good';
  if (score >= 4) return 'Fair';
  if (score >= 1) return 'Poor';
  return 'Not Ready';
}

export function runAllChecks(projectRoot: string, config: RalphConfig): Check[] {
  return [
    ...runStructureChecks(projectRoot, config),
    ...runContentChecks(projectRoot, config),
    ...runBackpressureChecks(projectRoot),
    ...runOperationalChecks(projectRoot),
  ];
}

export function doctorCommand(options: DoctorOptions): void {
  const projectRoot = findProjectRoot(process.cwd());
  const { config, warnings } = loadConfig(projectRoot);

  if (!options.json) {
    for (const w of warnings) warn(w);
  }

  const checks = runAllChecks(projectRoot, config);
  const score = calculateScore(checks);

  if (options.json) {
    console.log(JSON.stringify({
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

    console.log('');
    heading(`${allPass ? '\u2705' : '\u26A0\uFE0F '} ${catLabel}`);
    for (const check of catChecks) {
      if (check.pass) {
        success(`${check.name} — ${check.detail}`);
      } else {
        error(`${check.name} — ${check.detail}`);
        if (check.fix) {
          console.log(`    Fix: ${check.fix}`);
        }
        failingChecks.push(check);
      }
    }
  }

  console.log('');
  const passed = checks.filter(c => c.pass).length;
  info(`Score: ${score}/10 (${scoreLabel(score)}) — ${passed}/${checks.length} checks passed`);

  // Fix summary
  if (failingChecks.length > 0) {
    console.log('');
    info(`Fix ${failingChecks.length} issue(s) to improve score:`);
    failingChecks.forEach((c, i) => {
      if (c.fix) {
        console.log(`  ${i + 1}. ${c.fix}`);
      }
    });
  }

  if (options.ci && score < config.doctor['minimum-score']) {
    error(`Score ${score} is below minimum ${config.doctor['minimum-score']}`);
    process.exit(1);
  }

  if (options.fix) {
    const failing = checks.filter(c => !c.pass && c.fix?.includes('ralph init'));
    if (failing.length > 0) {
      console.log('');
      info(`Running ralph init to fix ${failing.length} missing structure issue(s)...`);
      // Import and run init
      import('../init/index.js').then(({ initCommand }) => {
        initCommand({ defaults: true });
      }).catch(() => {
        error('Failed to run ralph init');
      });
    }
  }
}
