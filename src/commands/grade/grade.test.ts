import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { scoreProject, scoreDomain, parseLcov, parseLcovForDomain, parseCoberturaXml, parseGoCoverage, parseGoCoverageForDomain, generateQualityMd, gradeCommand } from './index.js';
import type { RalphConfig } from '../../config/schema.js';
import { mergeWithDefaults } from '../../config/loader.js';

function makeTempDir(): string {
  const dir = join(tmpdir(), `ralph-grade-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeConfig(overrides?: Partial<{ name: string; language: string }>): RalphConfig {
  return mergeWithDefaults({
    project: {
      name: overrides?.name ?? 'test-project',
      language: (overrides?.language ?? 'typescript') as 'typescript',
    },
  });
}

function initGitRepo(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
}

describe('scoreProject', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    mkdirSync(join(tempDir, '.git'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('scores a bare repo with no docs or coverage', () => {
    const config = makeConfig();
    const score = scoreProject(tempDir, config);

    expect(score.domain).toBe('test-project');
    expect(score.docs.grade).toBe('F'); // no docs
    expect(score.tests.grade).toBe('C'); // no coverage tool = C default
    expect(score.staleness).toBeDefined();
    expect(score.overall).toBeDefined();
  });

  it('scores docs higher when files are present', () => {
    const config = makeConfig();

    // Create docs
    mkdirSync(join(tempDir, 'docs', 'design-docs'), { recursive: true });
    writeFileSync(join(tempDir, 'AGENTS.md'), '# Agents\n');
    writeFileSync(join(tempDir, 'ARCHITECTURE.md'), '# Arch\n');
    writeFileSync(join(tempDir, 'docs', 'design-docs', 'core-beliefs.md'), '# Beliefs\n');
    writeFileSync(join(tempDir, 'docs', 'DESIGN.md'), '# Design\n');
    writeFileSync(join(tempDir, 'docs', 'QUALITY_SCORE.md'), '# Quality\n');

    const score = scoreProject(tempDir, config);
    expect(score.docs.grade).toBe('A'); // all 5 docs present
  });

  it('scores architecture A when no violations exist', () => {
    const config = makeConfig();
    writeFileSync(join(tempDir, 'clean.ts'), 'export const x = 1;\n');

    const score = scoreProject(tempDir, config);
    expect(score.architecture.grade).toBe('A');
  });

  it('scores file health A when no oversized files', () => {
    const config = makeConfig();
    writeFileSync(join(tempDir, 'small.ts'), Array(50).fill('// line').join('\n'));

    const score = scoreProject(tempDir, config);
    expect(score.fileHealth.grade).toBe('A');
  });

  it('overall grade is the weakest dimension', () => {
    const config = makeConfig();
    // No docs = F docs grade, so overall should be F
    const score = scoreProject(tempDir, config);
    expect(score.overall).toBe('F');
  });

  it('includes staleness dimension in scoring', () => {
    const config = makeConfig();
    const score = scoreProject(tempDir, config);

    expect(score.staleness).toBeDefined();
    expect(score.staleness.grade).toBeDefined();
    expect(score.staleness.detail).toBeDefined();
    // With no source files, staleness should be A
    expect(score.staleness.grade).toBe('A');
    expect(score.staleness.detail).toContain('No source files');
  });

  it('staleness grades recently committed files as A', () => {
    initGitRepo(tempDir);
    writeFileSync(join(tempDir, 'app.ts'), 'export const x = 1;\n');
    execSync('git add -A && git commit -m "init"', { cwd: tempDir, stdio: 'pipe' });

    const config = makeConfig();
    const score = scoreProject(tempDir, config);

    expect(score.staleness.grade).toBe('A');
    expect(score.staleness.detail).toContain('Median');
  });

  it('staleness returns C when no git history is available', () => {
    // .git stub dir exists but no real git repo — git log will fail
    writeFileSync(join(tempDir, 'app.ts'), 'export const x = 1;\n');

    const config = makeConfig();
    const score = scoreProject(tempDir, config);

    expect(score.staleness.grade).toBe('C');
    expect(score.staleness.detail).toContain('No git history');
  });

  it('overall includes staleness in weakest-link calculation', () => {
    const config = makeConfig();

    // Create all docs so docs dimension is A
    mkdirSync(join(tempDir, 'docs', 'design-docs'), { recursive: true });
    writeFileSync(join(tempDir, 'AGENTS.md'), '# Agents\n');
    writeFileSync(join(tempDir, 'ARCHITECTURE.md'), '# Arch\n');
    writeFileSync(join(tempDir, 'docs', 'design-docs', 'core-beliefs.md'), '# Beliefs\n');
    writeFileSync(join(tempDir, 'docs', 'DESIGN.md'), '# Design\n');
    writeFileSync(join(tempDir, 'docs', 'QUALITY_SCORE.md'), '# Quality\n');

    const score = scoreProject(tempDir, config);
    // Overall should factor in all five dimensions including staleness
    const allGrades = [score.tests.grade, score.docs.grade, score.architecture.grade, score.fileHealth.grade, score.staleness.grade];
    const gradeOrder = ['A', 'B', 'C', 'D', 'F'];
    const worstIdx = Math.max(...allGrades.map(g => gradeOrder.indexOf(g)));
    expect(score.overall).toBe(gradeOrder[worstIdx]);
  });

  it('stores detail strings in history entries', () => {
    mkdirSync(join(tempDir, '.ralph'), { recursive: true });
    writeFileSync(join(tempDir, '.ralph', 'config.yml'), `project:\n  name: test\n  language: typescript\n`);
    mkdirSync(join(tempDir, 'src'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'main.ts'), 'export const x = 1;\n');
    const origCwd = process.cwd();
    process.chdir(tempDir);
    try { gradeCommand(undefined, {}); } catch { /* may warn */ }
    process.chdir(origCwd);
    const historyPath = join(tempDir, '.ralph', 'grade-history.jsonl');
    expect(existsSync(historyPath)).toBe(true);
    const content = readFileSync(historyPath, 'utf-8').trim();
    const entry = JSON.parse(content.split('\n').pop()!);
    // Should have detail fields stored alongside grades
    expect(entry.scores[0]).toHaveProperty('testsDetail');
    expect(entry.scores[0]).toHaveProperty('docsDetail');
    expect(entry.scores[0]).toHaveProperty('architectureDetail');
    expect(entry.scores[0]).toHaveProperty('fileHealthDetail');
    expect(entry.scores[0]).toHaveProperty('stalenessDetail');
  });

  it('creates .ralph/grade-history.jsonl when .ralph directory is missing', () => {
    const historyPath = join(tempDir, '.ralph', 'grade-history.jsonl');
    expect(existsSync(historyPath)).toBe(false);

    const origCwd = process.cwd();
    process.chdir(tempDir);
    try {
      gradeCommand(undefined, {});
    } finally {
      process.chdir(origCwd);
    }

    expect(existsSync(historyPath)).toBe(true);
  });
});

describe('parseLcov', () => {
  it('parses lcov format with LF/LH lines', () => {
    const lcov = `SF:src/index.ts
DA:1,1
DA:2,1
DA:3,0
LF:3
LH:2
end_of_record
SF:src/utils.ts
DA:1,1
LF:1
LH:1
end_of_record`;
    expect(parseLcov(lcov)).toBe(75); // 3 of 4 lines hit
  });

  it('returns null for non-lcov content', () => {
    expect(parseLcov('<coverage line-rate="0.8"/>')).toBeNull();
  });

  it('returns 0 when LF totals to 0', () => {
    expect(parseLcov('LF:0\nLH:0')).toBe(0);
  });
});

describe('parseCoberturaXml', () => {
  it('parses Cobertura XML with line-rate attribute', () => {
    const xml = `<?xml version="1.0" ?>
<coverage version="5.5" timestamp="1234" lines-valid="100" lines-covered="85" line-rate="0.85" branches-valid="0" branches-covered="0" branch-rate="0" complexity="0">
  <packages>
    <package name="." line-rate="0.85">
    </package>
  </packages>
</coverage>`;
    expect(parseCoberturaXml(xml)).toBe(85);
  });

  it('handles line-rate of 1.0 (100%)', () => {
    expect(parseCoberturaXml('<coverage line-rate="1.0">')).toBe(100);
  });

  it('handles line-rate of 0.0 (0%)', () => {
    expect(parseCoberturaXml('<coverage line-rate="0.0">')).toBe(0);
  });

  it('returns null for non-XML content', () => {
    expect(parseCoberturaXml('SF:src/index.ts\nLF:3\nLH:2')).toBeNull();
  });
});

describe('parseGoCoverage', () => {
  it('parses Go coverage profile', () => {
    const profile = `mode: set
github.com/user/repo/pkg/main.go:1.1,5.2 3 1
github.com/user/repo/pkg/main.go:7.1,10.2 2 0
github.com/user/repo/pkg/utils.go:1.1,3.2 5 1`;
    // 3 + 5 = 8 covered statements, 2 uncovered, total = 10
    expect(parseGoCoverage(profile)).toBe(80);
  });

  it('returns null for content without mode header', () => {
    expect(parseGoCoverage('not a go coverage file')).toBeNull();
  });

  it('handles 100% coverage', () => {
    const profile = `mode: atomic
file.go:1.1,5.2 10 1`;
    expect(parseGoCoverage(profile)).toBe(100);
  });

  it('handles 0% coverage', () => {
    const profile = `mode: count
file.go:1.1,5.2 10 0`;
    expect(parseGoCoverage(profile)).toBe(0);
  });
});

describe('scoreProject with coverage reports', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    mkdirSync(join(tempDir, '.git'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('reads lcov coverage report', () => {
    mkdirSync(join(tempDir, 'coverage'), { recursive: true });
    writeFileSync(join(tempDir, 'coverage', 'lcov.info'), 'SF:src/index.ts\nLF:10\nLH:9\nend_of_record\n');

    const config = mergeWithDefaults({
      project: { name: 'test', language: 'typescript' as const },
      quality: { coverage: { tool: 'vitest' as const, 'report-path': 'coverage/lcov.info' } },
    });

    const score = scoreProject(tempDir, config);
    expect(score.tests.grade).toBe('A'); // 90%
    expect(score.tests.detail).toContain('90%');
  });

  it('reads Cobertura XML coverage report for pytest', () => {
    writeFileSync(join(tempDir, 'coverage.xml'), '<coverage line-rate="0.72" branch-rate="0.5">\n</coverage>\n');

    const config = mergeWithDefaults({
      project: { name: 'test', language: 'python' as const },
      quality: { coverage: { tool: 'pytest' as const, 'report-path': 'coverage.xml' } },
    });

    const score = scoreProject(tempDir, config);
    expect(score.tests.grade).toBe('C'); // 72%
    expect(score.tests.detail).toContain('72%');
  });

  it('reads Go coverage profile for go-test', () => {
    writeFileSync(join(tempDir, 'coverage.out'), 'mode: set\nfile.go:1.1,5.2 10 1\nfile.go:7.1,9.2 10 1\n');

    const config = mergeWithDefaults({
      project: { name: 'test', language: 'go' as const },
      quality: { coverage: { tool: 'go-test' as const, 'report-path': 'coverage.out' } },
    });

    const score = scoreProject(tempDir, config);
    expect(score.tests.grade).toBe('A'); // 100%
    expect(score.tests.detail).toContain('100%');
  });

  it('auto-detects format when tool-specific parsing fails', () => {
    // Config says vitest but file is actually Cobertura XML
    writeFileSync(join(tempDir, 'report.xml'), '<coverage line-rate="0.65">\n</coverage>\n');

    const config = mergeWithDefaults({
      project: { name: 'test', language: 'typescript' as const },
      quality: { coverage: { tool: 'vitest' as const, 'report-path': 'report.xml' } },
    });

    const score = scoreProject(tempDir, config);
    expect(score.tests.grade).toBe('C'); // 65%
  });
});

describe('DomainScore structure', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    mkdirSync(join(tempDir, '.git'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('has all five dimensions plus overall', () => {
    const config = makeConfig();
    const score = scoreProject(tempDir, config);

    expect(score).toHaveProperty('tests');
    expect(score).toHaveProperty('docs');
    expect(score).toHaveProperty('architecture');
    expect(score).toHaveProperty('fileHealth');
    expect(score).toHaveProperty('staleness');
    expect(score).toHaveProperty('overall');
  });
});

describe('parseLcovForDomain', () => {
  it('filters lcov records to a specific domain path', () => {
    const lcov = `SF:src/auth/login.ts
DA:1,1
DA:2,1
LF:2
LH:2
end_of_record
SF:src/billing/charge.ts
DA:1,1
DA:2,0
LF:2
LH:1
end_of_record`;
    // Only auth records: 2/2 = 100%
    expect(parseLcovForDomain(lcov, 'src/auth')).toBe(100);
    // Only billing records: 1/2 = 50%
    expect(parseLcovForDomain(lcov, 'src/billing')).toBe(50);
  });

  it('returns null when no records match domain path', () => {
    const lcov = `SF:src/auth/login.ts
LF:2
LH:2
end_of_record`;
    expect(parseLcovForDomain(lcov, 'src/billing')).toBeNull();
  });

  it('handles multiple records in same domain', () => {
    const lcov = `SF:src/auth/login.ts
LF:10
LH:9
end_of_record
SF:src/auth/register.ts
LF:10
LH:7
end_of_record`;
    // 16/20 = 80%
    expect(parseLcovForDomain(lcov, 'src/auth')).toBe(80);
  });
});

describe('parseGoCoverageForDomain', () => {
  it('filters Go coverage to a specific domain path', () => {
    const profile = `mode: set
github.com/user/repo/auth/handler.go:1.1,5.2 5 1
github.com/user/repo/billing/charge.go:1.1,5.2 5 0
github.com/user/repo/auth/middleware.go:1.1,3.2 5 1`;
    // auth: 10/10 = 100%
    expect(parseGoCoverageForDomain(profile, 'auth')).toBe(100);
    // billing: 0/5 = 0%
    expect(parseGoCoverageForDomain(profile, 'billing')).toBe(0);
  });

  it('returns null when no lines match domain', () => {
    const profile = `mode: set
github.com/user/repo/auth/handler.go:1.1,5.2 5 1`;
    expect(parseGoCoverageForDomain(profile, 'billing')).toBeNull();
  });
});

describe('scoreDomain', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
    mkdirSync(join(tempDir, '.git'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('scores files only within the domain path', () => {
    // Create files in two domains
    mkdirSync(join(tempDir, 'src', 'auth'), { recursive: true });
    mkdirSync(join(tempDir, 'src', 'billing'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'auth', 'login.ts'), 'export const login = () => {};\n');
    // billing has an oversized file
    writeFileSync(join(tempDir, 'src', 'billing', 'charge.ts'), Array(600).fill('// line').join('\n'));

    const config = mergeWithDefaults({
      project: { name: 'test', language: 'typescript' as const },
      architecture: {
        domains: [
          { name: 'auth', path: 'src/auth' },
          { name: 'billing', path: 'src/billing' },
        ],
      },
    });

    const authScore = scoreDomain(tempDir, config, { name: 'auth', path: 'src/auth' });
    const billingScore = scoreDomain(tempDir, config, { name: 'billing', path: 'src/billing' });

    expect(authScore.domain).toBe('auth');
    expect(authScore.fileHealth.grade).toBe('A'); // small file
    expect(billingScore.domain).toBe('billing');
    // billing has an oversized file (600 lines > 500 default max)
    expect(['D', 'F']).toContain(billingScore.fileHealth.grade);
  });

  it('uses domain name in the score', () => {
    mkdirSync(join(tempDir, 'src', 'auth'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'auth', 'index.ts'), 'export const x = 1;\n');

    const config = makeConfig();
    const score = scoreDomain(tempDir, config, { name: 'auth', path: 'src/auth' });

    expect(score.domain).toBe('auth');
  });

  it('scores domain documentation from domain-specific files', () => {
    mkdirSync(join(tempDir, 'src', 'auth'), { recursive: true });
    mkdirSync(join(tempDir, 'docs', 'design-docs'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'auth', 'index.ts'), 'export const x = 1;\n');
    // Create domain-specific design doc
    writeFileSync(join(tempDir, 'src', 'auth', 'DESIGN.md'), '# Auth Design\n');
    writeFileSync(join(tempDir, 'docs', 'design-docs', 'auth.md'), '# Auth\n');

    const config = makeConfig();
    const score = scoreDomain(tempDir, config, { name: 'auth', path: 'src/auth' });

    // 2 of 3 domain docs present = 67% = C
    expect(score.docs.grade).toBe('C');
    expect(score.docs.detail).toContain('2/3');
  });

  it('returns A grades for empty domain directory', () => {
    mkdirSync(join(tempDir, 'src', 'empty'), { recursive: true });

    const config = makeConfig();
    const score = scoreDomain(tempDir, config, { name: 'empty', path: 'src/empty' });

    expect(score.domain).toBe('empty');
    expect(score.architecture.grade).toBe('A');
    expect(score.fileHealth.grade).toBe('A');
    expect(score.staleness.grade).toBe('A');
  });

  it('scores domain coverage from lcov filtered by domain path', () => {
    mkdirSync(join(tempDir, 'src', 'auth'), { recursive: true });
    mkdirSync(join(tempDir, 'coverage'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'auth', 'login.ts'), 'export const x = 1;\n');
    writeFileSync(join(tempDir, 'coverage', 'lcov.info'),
      `SF:src/auth/login.ts\nLF:10\nLH:9\nend_of_record\nSF:src/billing/charge.ts\nLF:10\nLH:3\nend_of_record\n`);

    const config = mergeWithDefaults({
      project: { name: 'test', language: 'typescript' as const },
      quality: { coverage: { tool: 'vitest' as const, 'report-path': 'coverage/lcov.info' } },
    });

    const score = scoreDomain(tempDir, config, { name: 'auth', path: 'src/auth' });
    expect(score.tests.grade).toBe('A'); // 90% for auth only
    expect(score.tests.detail).toContain('90%');
  });

  it('overall grade for domain is weakest dimension', () => {
    mkdirSync(join(tempDir, 'src', 'auth'), { recursive: true });
    writeFileSync(join(tempDir, 'src', 'auth', 'index.ts'), 'export const x = 1;\n');

    const config = makeConfig();
    const score = scoreDomain(tempDir, config, { name: 'auth', path: 'src/auth' });

    // Overall should be the worst of all dimensions
    const allGrades = [score.tests.grade, score.docs.grade, score.architecture.grade, score.fileHealth.grade, score.staleness.grade];
    const gradeOrder = ['A', 'B', 'C', 'D', 'F'];
    const worstIdx = Math.max(...allGrades.map(g => gradeOrder.indexOf(g)));
    expect(score.overall).toBe(gradeOrder[worstIdx]);
  });
});

describe('generateQualityMd', () => {
  it('uses "Quality Grades" title per spec', () => {
    const scores = [{
      domain: 'test',
      tests: { grade: 'A' as const, detail: '90%' },
      docs: { grade: 'B' as const, detail: '3/5' },
      architecture: { grade: 'A' as const, detail: 'clean' },
      fileHealth: { grade: 'A' as const, detail: 'ok' },
      staleness: { grade: 'A' as const, detail: 'recent' },
      overall: 'B' as const,
    }];
    const md = generateQualityMd(scores, []);
    expect(md).toMatch(/^# Quality Grades\n/);
  });

  it('includes "Last updated" date', () => {
    const scores = [{
      domain: 'test',
      tests: { grade: 'A' as const, detail: '90%' },
      docs: { grade: 'A' as const, detail: '5/5' },
      architecture: { grade: 'A' as const, detail: 'clean' },
      fileHealth: { grade: 'A' as const, detail: 'ok' },
      staleness: { grade: 'A' as const, detail: 'recent' },
      overall: 'A' as const,
    }];
    const md = generateQualityMd(scores, []);
    expect(md).toMatch(/Last updated: \d{4}-\d{2}-\d{2}/);
  });

  it('includes Staleness column in output table', () => {
    const scores = [{
      domain: 'auth',
      tests: { grade: 'B' as const, detail: '80%' },
      docs: { grade: 'C' as const, detail: '2/5' },
      architecture: { grade: 'A' as const, detail: 'clean' },
      fileHealth: { grade: 'A' as const, detail: 'ok' },
      staleness: { grade: 'B' as const, detail: 'recent' },
      overall: 'C' as const,
    }];
    const md = generateQualityMd(scores, []);
    expect(md).toContain('| Staleness |');
    expect(md).toContain('| B |');
  });

  it('formats trends as "current (was previous)" per spec', () => {
    const history = [{
      timestamp: '2026-03-01T00:00:00Z',
      scores: [{ domain: 'auth', tests: 'B' as const, docs: 'D' as const, architecture: 'A' as const, fileHealth: 'A' as const, staleness: 'A' as const, overall: 'D' as const }],
    }];
    const scores = [{
      domain: 'auth',
      tests: { grade: 'A' as const, detail: '95%' },
      docs: { grade: 'B' as const, detail: '4/5' },
      architecture: { grade: 'A' as const, detail: 'clean' },
      fileHealth: { grade: 'A' as const, detail: 'ok' },
      staleness: { grade: 'A' as const, detail: 'recent' },
      overall: 'A' as const,
    }];
    const md = generateQualityMd(scores, history);
    // Should use spec format: "current (was previous [temporal]) — improved/degraded"
    expect(md).toMatch(/auth\/tests: A \(was B.*\) — improved/);
    expect(md).toMatch(/auth\/docs: B \(was D.*\) — improved/);
  });

  it('includes temporal context in trend labels', () => {
    // History from yesterday
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const history = [{
      timestamp: yesterday,
      scores: [{ domain: 'auth', tests: 'C' as const, docs: 'A' as const, architecture: 'A' as const, fileHealth: 'A' as const, staleness: 'A' as const, overall: 'C' as const }],
    }];
    const scores = [{
      domain: 'auth',
      tests: { grade: 'A' as const, detail: '95%' },
      docs: { grade: 'A' as const, detail: '5/5' },
      architecture: { grade: 'A' as const, detail: 'clean' },
      fileHealth: { grade: 'A' as const, detail: 'ok' },
      staleness: { grade: 'A' as const, detail: 'recent' },
      overall: 'A' as const,
    }];
    const md = generateQualityMd(scores, history);
    // Should include "yesterday" temporal label
    expect(md).toContain('was C yesterday');
  });

  it('includes stable indicator when grade is unchanged', () => {
    const history = [{
      timestamp: '2026-03-01T00:00:00Z',
      scores: [{ domain: 'auth', tests: 'A' as const, docs: 'B' as const, architecture: 'A' as const, fileHealth: 'A' as const, staleness: 'A' as const, overall: 'A' as const }],
    }];
    const scores = [{
      domain: 'auth',
      tests: { grade: 'A' as const, detail: '95%' },
      docs: { grade: 'B' as const, detail: '4/5' },
      architecture: { grade: 'A' as const, detail: 'clean' },
      fileHealth: { grade: 'A' as const, detail: 'ok' },
      staleness: { grade: 'A' as const, detail: 'recent' },
      overall: 'A' as const,
    }];
    const md = generateQualityMd(scores, history);
    // Unchanged grades should show "stable" indicator
    expect(md).toContain('auth/tests: A (stable)');
    expect(md).toContain('auth/docs: B (stable)');
    expect(md).toContain('auth/overall: A (stable)');
  });

  it('includes detail reasons in trend labels', () => {
    const history = [{
      timestamp: '2026-03-01T00:00:00Z',
      scores: [{
        domain: 'billing',
        tests: 'B' as const, docs: 'D' as const, architecture: 'A' as const,
        fileHealth: 'A' as const, staleness: 'A' as const, overall: 'D' as const,
        docsDetail: '1/5 domain documentation files present',
      }],
    }];
    const scores = [{
      domain: 'billing',
      tests: { grade: 'A' as const, detail: '95% coverage' },
      docs: { grade: 'F' as const, detail: '0/5 domain documentation files present' },
      architecture: { grade: 'A' as const, detail: 'No architectural violations' },
      fileHealth: { grade: 'A' as const, detail: 'Avg 100 lines, no oversized files' },
      staleness: { grade: 'A' as const, detail: 'Median 2 days' },
      overall: 'F' as const,
    }];
    const md = generateQualityMd(scores, history);
    // Degraded docs should include detail reason
    expect(md).toMatch(/billing\/docs: F.*degraded.*0\/5 domain documentation/);
    // Stable architecture should include detail reason
    expect(md).toContain('No architectural violations');
    // Improved tests should include detail reason
    expect(md).toMatch(/billing\/tests: A.*improved.*95% coverage/);
  });

  it('detects per-dimension sustained degradation', () => {
    const history = [
      {
        timestamp: '2026-03-01T00:00:00Z',
        scores: [{ domain: 'auth', tests: 'A' as const, docs: 'A' as const, architecture: 'A' as const, fileHealth: 'A' as const, staleness: 'A' as const, overall: 'A' as const }],
      },
      {
        timestamp: '2026-03-02T00:00:00Z',
        scores: [{ domain: 'auth', tests: 'B' as const, docs: 'A' as const, architecture: 'A' as const, fileHealth: 'A' as const, staleness: 'A' as const, overall: 'B' as const }],
      },
      {
        timestamp: '2026-03-03T00:00:00Z',
        scores: [{ domain: 'auth', tests: 'C' as const, docs: 'A' as const, architecture: 'A' as const, fileHealth: 'A' as const, staleness: 'A' as const, overall: 'C' as const }],
      },
    ];
    // Current score continues the drop in tests
    const scores = [{
      domain: 'auth',
      tests: { grade: 'D' as const, detail: '35%' },
      docs: { grade: 'A' as const, detail: '5/5' },
      architecture: { grade: 'A' as const, detail: 'clean' },
      fileHealth: { grade: 'A' as const, detail: 'ok' },
      staleness: { grade: 'A' as const, detail: 'recent' },
      overall: 'D' as const,
    }];
    const md = generateQualityMd(scores, history);
    // Should detect per-dimension sustained degradation for tests
    expect(md).toContain('auth/tests: sustained degradation');
  });

  it('detects per-dimension sustained improvement', () => {
    const history = [
      {
        timestamp: '2026-03-01T00:00:00Z',
        scores: [{ domain: 'billing', tests: 'D' as const, docs: 'F' as const, architecture: 'A' as const, fileHealth: 'A' as const, staleness: 'A' as const, overall: 'F' as const }],
      },
      {
        timestamp: '2026-03-02T00:00:00Z',
        scores: [{ domain: 'billing', tests: 'C' as const, docs: 'D' as const, architecture: 'A' as const, fileHealth: 'A' as const, staleness: 'A' as const, overall: 'D' as const }],
      },
      {
        timestamp: '2026-03-03T00:00:00Z',
        scores: [{ domain: 'billing', tests: 'B' as const, docs: 'C' as const, architecture: 'A' as const, fileHealth: 'A' as const, staleness: 'A' as const, overall: 'C' as const }],
      },
    ];
    const scores = [{
      domain: 'billing',
      tests: { grade: 'A' as const, detail: '95%' },
      docs: { grade: 'B' as const, detail: '4/5' },
      architecture: { grade: 'A' as const, detail: 'clean' },
      fileHealth: { grade: 'A' as const, detail: 'ok' },
      staleness: { grade: 'A' as const, detail: 'recent' },
      overall: 'A' as const,
    }];
    const md = generateQualityMd(scores, history);
    // Should detect per-dimension sustained improvement for tests and docs
    expect(md).toContain('billing/tests: sustained improvement');
    expect(md).toContain('billing/docs: sustained improvement');
  });

  it('generates action items for non-A domains with specific details', () => {
    const scores = [{
      domain: 'billing',
      tests: { grade: 'F' as const, detail: '10% line coverage' },
      docs: { grade: 'D' as const, detail: '1/5 documentation files present' },
      architecture: { grade: 'C' as const, detail: '4 violation(s) in billing.ts, api.ts' },
      fileHealth: { grade: 'D' as const, detail: 'Avg 300 lines, 5 oversized: routes.ts (847), handler.ts (600)' },
      staleness: { grade: 'A' as const, detail: 'recent' },
      overall: 'F' as const,
    }];
    const md = generateQualityMd(scores, []);
    expect(md).toContain('## Action Items');
    expect(md).toContain('billing: Improve test coverage');
    expect(md).toContain('10% line coverage');
    expect(md).toContain('billing: Add missing documentation');
    expect(md).toContain('billing: Reduce architectural violations');
    expect(md).toContain('billing: Split oversized files');
  });
});
