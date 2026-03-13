import { join } from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import type { RalphConfig } from '../../config/schema.js';

export interface Check {
  name: string;
  category: 'structure' | 'content' | 'backpressure' | 'operational';
  pass: boolean;
  detail: string;
  fix?: string | undefined;
}

export const doctorRuntime = {
  execSync,
};

function runStructureChecks(projectRoot: string, config: RalphConfig): Check[] {
  const checks: Check[] = [];
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

  const archPath = join(projectRoot, config.paths['architecture-md']);
  checks.push({
    name: 'ARCHITECTURE.md exists',
    category: 'structure',
    pass: existsSync(archPath),
    detail: existsSync(archPath) ? 'Present' : 'Missing',
    fix: existsSync(archPath) ? undefined : 'Run `ralph init` to create ARCHITECTURE.md',
  });

  const docDirs = ['design-docs', 'product-specs', 'references', 'generated'] as const;
  for (const dir of docDirs) {
    const dirKey = dir === 'design-docs' ? 'design-docs' :
                   dir === 'product-specs' ? 'specs' :
                   dir;
    const dirPath = join(projectRoot, config.paths[dirKey as keyof typeof config.paths] as string);
    if (existsSync(dirPath)) {
      let detail = 'Present';
      if (dir === 'product-specs') {
        try {
          const specFiles = readdirSync(dirPath).filter(f => f.endsWith('.md'));
          detail = specFiles.length > 0 ? `${specFiles.length} spec file(s)` : 'Present (empty)';
        } catch { /* ignore */ }
      }
      checks.push({
        name: `docs/${dir}/ exists`,
        category: 'structure',
        pass: true,
        detail,
      });
    } else {
      checks.push({
        name: `docs/${dir}/ exists`,
        category: 'structure',
        pass: false,
        detail: 'Missing',
        fix: `Run \`ralph init\` to create docs/${dir}/`,
      });
    }
  }

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

  const configPath = join(projectRoot, '.ralph', 'config.yml');
  checks.push({
    name: '.ralph/config.yml valid',
    category: 'structure',
    pass: existsSync(configPath),
    detail: existsSync(configPath) ? 'Present and valid' : 'Missing',
    fix: existsSync(configPath) ? undefined : 'Run `ralph init` to create .ralph/config.yml',
  });

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

  const qualityPath = join(projectRoot, config.paths.quality);
  checks.push({
    name: 'QUALITY_SCORE.md exists',
    category: 'structure',
    pass: existsSync(qualityPath),
    detail: existsSync(qualityPath) ? 'Present' : 'Missing',
    fix: existsSync(qualityPath) ? undefined : 'Run `ralph grade` to generate QUALITY_SCORE.md',
  });

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

    const llmTerms = ['openai', 'anthropic', 'gpt-4', 'gpt-3', 'chatgpt', 'gemini', 'claude', 'copilot'];
    const agentsLines = readFileSync(agentsPath, 'utf-8').split('\n');
    let llmLineNum: number | undefined;
    let llmTerm: string | undefined;
    for (let i = 0; i < agentsLines.length; i++) {
      const lower = (agentsLines[i] ?? '').toLowerCase();
      const found = llmTerms.find(t => lower.includes(t));
      if (found) {
        llmLineNum = i + 1;
        llmTerm = found;
        break;
      }
    }
    const hasLlmRefs = llmLineNum !== undefined;
    checks.push({
      name: 'AGENTS.md has no LLM provider references',
      category: 'content',
      pass: !hasLlmRefs,
      detail: hasLlmRefs ? `References "${llmTerm}" on line ${llmLineNum}` : 'Clean',
      fix: hasLlmRefs ? `Remove LLM-specific references from AGENTS.md (line ${llmLineNum})` : undefined,
    });

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

  const archPath = join(projectRoot, config.paths['architecture-md']);
  if (existsSync(archPath)) {
    const archContent = readFileSync(archPath, 'utf-8');
    const archLower = archContent.toLowerCase();
    const hasDomains = archLower.includes('domain') || archLower.includes('boundary') || archLower.includes('layer');
    const domainHeadings = archContent.match(/^#{2,3}\s+\S+/gm) ?? [];
    const domainCount = domainHeadings.length;
    checks.push({
      name: 'ARCHITECTURE.md describes boundaries',
      category: 'content',
      pass: hasDomains,
      detail: hasDomains ? `Describes ${domainCount} domain(s)/section(s)` : 'No domain or layer descriptions found',
      fix: hasDomains ? undefined : 'Add domain boundaries and layer descriptions to ARCHITECTURE.md',
    });
  }

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

  const trackerPath = join(projectRoot, config.paths.plans, 'tech-debt-tracker.md');
  checks.push({
    name: 'tech-debt-tracker.md exists',
    category: 'content',
    pass: existsSync(trackerPath),
    detail: existsSync(trackerPath) ? 'Present' : 'Missing',
    fix: existsSync(trackerPath) ? undefined : 'Run `ralph init` to create tech-debt-tracker.md',
  });

  const specsDir = join(projectRoot, config.paths.specs);
  if (!existsSync(specsDir)) {
    checks.push({
      name: 'Spec files have ## Motivation sections',
      category: 'content',
      pass: true,
      detail: 'No spec files found',
      fix: 'Add a ## Motivation section to each spec describing why the feature exists.',
    });
  } else {
    const specFiles = (() => {
      try { return readdirSync(specsDir).filter(f => f.endsWith('.md')); } catch { return []; }
    })();
    if (specFiles.length === 0) {
      checks.push({
        name: 'Spec files have ## Motivation sections',
        category: 'content',
        pass: true,
        detail: 'No spec files found',
        fix: 'Add a ## Motivation section to each spec describing why the feature exists.',
      });
    } else {
      const missing: string[] = [];
      for (const file of specFiles) {
        try {
          const content = readFileSync(join(specsDir, file), 'utf-8');
          const lines = content.split('\n');
          const hasMotivation = lines.some(line => /^## /.test(line) && /motivation/i.test(line.slice(3)));
          if (!hasMotivation) missing.push(file);
        } catch { missing.push(file); }
      }
      const n = specFiles.length;
      const m = missing.length;
      checks.push({
        name: 'Spec files have ## Motivation sections',
        category: 'content',
        pass: m === 0,
        detail: m === 0
          ? `All ${n} spec(s) have ## Motivation sections`
          : `${m} of ${n} spec(s) missing ## Motivation section: ${missing.join(', ')}`,
        fix: m > 0 ? 'Add a ## Motivation section to each spec describing why the feature exists.' : undefined,
      });
    }
  }

  return checks;
}

function runBackpressureChecks(projectRoot: string): Check[] {
  const checks: Check[] = [];
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

  const pyprojectPath = join(projectRoot, 'pyproject.toml');
  if (existsSync(pyprojectPath)) {
    hasTestRunner = true;
    hasTypeChecker = true;
    if (!hasLinter) {
      try {
        const pyContent = readFileSync(pyprojectPath, 'utf-8');
        hasLinter = !!(
          pyContent.includes('[tool.ruff') ||
          pyContent.includes('ruff') ||
          pyContent.includes('pylint') ||
          pyContent.includes('flake8')
        );
      } catch { /* ignore */ }
    }
  }

  if (existsSync(join(projectRoot, 'go.mod'))) {
    hasTestRunner = true;
    hasTypeChecker = true;
    if (!hasLinter) {
      const golangciConfigs = ['.golangci.yml', '.golangci.yaml', '.golangci.toml', '.golangci.json'];
      hasLinter = golangciConfigs.some(f => existsSync(join(projectRoot, f)));
    }
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

  let hasTestFiles = false;
  try {
    const findTestFiles = (dir: string, depth: number): boolean => {
      if (depth > 4) return false;
      if (!existsSync(dir)) return false;
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
        if (entry.isFile()) {
          if (/\.(test|spec)\.[jt]sx?$/.test(entry.name) ||
              /^test_.*\.py$/.test(entry.name) ||
              /.*_test\.py$/.test(entry.name) ||
              /.*_test\.go$/.test(entry.name) ||
              /.*_test\.rs$/.test(entry.name)) {
            return true;
          }
        } else if (entry.isDirectory()) {
          if (findTestFiles(join(dir, entry.name), depth + 1)) return true;
        }
      }
      return false;
    };
    hasTestFiles = findTestFiles(projectRoot, 0);
  } catch { /* ignore */ }

  checks.push({
    name: 'Test files exist',
    category: 'backpressure',
    pass: hasTestFiles,
    detail: hasTestFiles ? 'Test files found' : 'No test files found',
    fix: hasTestFiles ? undefined : 'Add test files (e.g., *.test.ts, *_test.go, test_*.py)',
  });

  if (hasTestRunner && hasTestFiles) {
    let testCmd = '';
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
        const scripts = pkg['scripts'] as Record<string, string> | undefined;
        if (scripts?.['test']) {
          testCmd = 'npm test';
        }
      } catch { /* ignore */ }
    }
    if (!testCmd && existsSync(join(projectRoot, 'go.mod'))) {
      testCmd = 'go test ./...';
    }
    if (!testCmd && existsSync(join(projectRoot, 'pyproject.toml'))) {
      testCmd = 'python -m pytest';
    }

    if (testCmd) {
      let testsPass = false;
      let testDetail = '';
      try {
        doctorRuntime.execSync(testCmd, {
          cwd: projectRoot,
          stdio: 'ignore',
          timeout: 60000,
        });
        testsPass = true;
        testDetail = `\`${testCmd}\` exits 0`;
      } catch (err: unknown) {
        const execErr = err as { killed?: boolean; status?: number };
        if (execErr.killed) {
          testDetail = `\`${testCmd}\` timed out (>60s)`;
        } else {
          testDetail = `\`${testCmd}\` failed (exit ${execErr.status ?? 'unknown'})`;
        }
      }
      checks.push({
        name: 'Tests run successfully',
        category: 'backpressure',
        pass: testsPass,
        detail: testDetail,
        fix: testsPass ? undefined : `Fix failing tests: run \`${testCmd}\` and resolve errors`,
      });
    }
  }

  const configPath = join(projectRoot, '.ralph', 'config.yml');
  let hasLintRules = false;
  if (existsSync(configPath)) {
    try {
      const configContent = readFileSync(configPath, 'utf-8');
      hasLintRules = configContent.includes('layers:') || configContent.includes('domains:');
    } catch { /* ignore */ }
  }
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
  const isGitRepo = existsSync(join(projectRoot, '.git'));
  checks.push({
    name: 'Git repository',
    category: 'operational',
    pass: isGitRepo,
    detail: isGitRepo ? 'Initialized' : 'Not a git repo',
    fix: isGitRepo ? undefined : 'Run `git init`',
  });

  if (isGitRepo) {
    let commitCount = 0;
    try {
      const output = doctorRuntime.execSync(
        'git rev-list --count HEAD',
        { cwd: projectRoot, stdio: ['pipe', 'pipe', 'pipe'] },
      ).toString().trim();
      commitCount = parseInt(output, 10) || 0;
    } catch {
    }
    checks.push({
      name: 'At least one commit',
      category: 'operational',
      pass: commitCount > 0,
      detail: commitCount > 0 ? `${commitCount} commits` : 'No commits',
      fix: commitCount === 0 ? 'Make an initial commit: `git add -A && git commit -m "Initial commit"`' : undefined,
    });
  }

  const hasGitignore = existsSync(join(projectRoot, '.gitignore'));
  checks.push({
    name: '.gitignore exists',
    category: 'operational',
    pass: hasGitignore,
    detail: hasGitignore ? 'Present' : 'Missing',
    fix: hasGitignore ? undefined : 'Create a .gitignore file',
  });

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

export { calculateScore, scoreLabel } from './scoring.js';

export function runAllChecks(projectRoot: string, config: RalphConfig): Check[] {
  return [
    ...runStructureChecks(projectRoot, config),
    ...runContentChecks(projectRoot, config),
    ...runBackpressureChecks(projectRoot),
    ...runOperationalChecks(projectRoot),
  ];
}
