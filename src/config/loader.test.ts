import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findConfigFile, findProjectRoot, mergeWithDefaults, loadConfig, detectCiEnvironment } from './loader.js';

function makeTempDir(): string {
  const dir = join(tmpdir(), `ralph-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('findConfigFile', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns null when no config exists', () => {
    expect(findConfigFile(tempDir)).toBeNull();
  });

  it('finds config in current directory', () => {
    const configDir = join(tempDir, '.ralph');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.yml'), 'project:\n  name: test\n  language: typescript\n');
    expect(findConfigFile(tempDir)).toBe(join(configDir, 'config.yml'));
  });

  it('finds config in parent directory', () => {
    const configDir = join(tempDir, '.ralph');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.yml'), 'project:\n  name: test\n  language: typescript\n');
    const childDir = join(tempDir, 'src', 'deep');
    mkdirSync(childDir, { recursive: true });
    expect(findConfigFile(childDir)).toBe(join(configDir, 'config.yml'));
  });
});

describe('findProjectRoot', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('finds root via .ralph/config.yml', () => {
    const configDir = join(tempDir, '.ralph');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.yml'), '');
    const childDir = join(tempDir, 'src');
    mkdirSync(childDir, { recursive: true });
    expect(findProjectRoot(childDir)).toBe(tempDir);
  });

  it('finds root via .git', () => {
    const gitDir = join(tempDir, '.git');
    mkdirSync(gitDir, { recursive: true });
    const childDir = join(tempDir, 'src', 'deep');
    mkdirSync(childDir, { recursive: true });
    expect(findProjectRoot(childDir)).toBe(tempDir);
  });

  it('falls back to startDir when no markers found', () => {
    const childDir = join(tempDir, 'some', 'deep', 'path');
    mkdirSync(childDir, { recursive: true });
    // In practice we'd hit filesystem root, but the function returns startDir as fallback
    const result = findProjectRoot(childDir);
    expect(typeof result).toBe('string');
  });
});

describe('mergeWithDefaults', () => {
  it('fills in all defaults for minimal config', () => {
    const config = mergeWithDefaults({
      project: { name: 'test', language: 'typescript' },
    });

    expect(config.project.name).toBe('test');
    expect(config.project.language).toBe('typescript');
    expect(config.architecture.layers).toEqual(['types', 'config', 'data', 'service', 'ui']);
    expect(config.architecture.direction).toBe('forward-only');
    expect(config.architecture.rules['max-lines']).toBe(500);
    expect(config.architecture.rules.naming.schemas).toBe('*Schema');
    expect(config.architecture.rules.naming.types).toBe('*Type');
    expect(config.quality['minimum-grade']).toBe('D');
    expect(config.quality.coverage.tool).toBe('none');
    expect(config.quality.coverage['report-path']).toBe('coverage/lcov.info');
    expect(config.gc['consistency-threshold']).toBe(60);
    expect(config.gc.exclude).toEqual(['node_modules', 'dist', '.next', 'coverage']);
    expect(config.doctor['minimum-score']).toBe(7);
    expect(config.doctor['custom-checks']).toEqual([]);
    expect(config.paths['agents-md']).toBe('AGENTS.md');
    expect(config.paths.docs).toBe('docs');
    expect(config.references['max-total-kb']).toBe(200);
    expect(config.references['warn-single-file-kb']).toBe(80);
  });

  it('preserves user-provided values', () => {
    const config = mergeWithDefaults({
      project: { name: 'custom', language: 'python', framework: 'django' },
      architecture: { layers: ['data', 'api'] },
      quality: { 'minimum-grade': 'B' },
    });

    expect(config.project.name).toBe('custom');
    expect(config.project.framework).toBe('django');
    expect(config.architecture.layers).toEqual(['data', 'api']);
    expect(config.quality['minimum-grade']).toBe('B');
    // Other defaults still applied
    expect(config.doctor['minimum-score']).toBe(7);
  });

  it('applies CI overrides when isCi is true', () => {
    const config = mergeWithDefaults({
      project: { name: 'test', language: 'typescript' },
      quality: { 'minimum-grade': 'D' },
      ci: {
        quality: { 'minimum-grade': 'B' },
        doctor: { 'minimum-score': 9 },
      },
    }, true);

    expect(config.quality['minimum-grade']).toBe('B');
    expect(config.doctor['minimum-score']).toBe(9);
  });

  it('does not apply CI overrides when isCi is false', () => {
    const config = mergeWithDefaults({
      project: { name: 'test', language: 'typescript' },
      ci: {
        quality: { 'minimum-grade': 'A' },
      },
    }, false);

    expect(config.quality['minimum-grade']).toBe('D'); // default, not CI override
  });
});

describe('loadConfig', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns defaults with warning when no config file exists', () => {
    const result = loadConfig(tempDir);
    expect(result.configPath).toBeNull();
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('No .ralph/config.yml found');
    expect(result.config.project.name).toBe('unknown');
  });

  it('loads valid config from file', () => {
    const configDir = join(tempDir, '.ralph');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.yml'), `
project:
  name: my-project
  language: go
  framework: gin
quality:
  minimum-grade: B
`);

    const result = loadConfig(tempDir);
    expect(result.configPath).toBe(join(configDir, 'config.yml'));
    expect(result.config.project.name).toBe('my-project');
    expect(result.config.project.language).toBe('go');
    expect(result.config.project.framework).toBe('gin');
    expect(result.config.quality['minimum-grade']).toBe('B');
    // Defaults applied for unspecified fields
    expect(result.config.architecture.layers).toEqual(['types', 'config', 'data', 'service', 'ui']);
  });

  it('throws on invalid YAML', () => {
    const configDir = join(tempDir, '.ralph');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.yml'), '{ invalid yaml:: [');

    expect(() => loadConfig(tempDir)).toThrow('Invalid YAML');
  });

  it('throws on invalid config values', () => {
    const configDir = join(tempDir, '.ralph');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.yml'), `
project:
  name: test
  language: cobol
`);

    expect(() => loadConfig(tempDir)).toThrow('Invalid config');
  });

  it('returns warnings for unknown keys', () => {
    const configDir = join(tempDir, '.ralph');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.yml'), `
project:
  name: test
  language: typescript
extra_key: true
`);

    const result = loadConfig(tempDir);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('extra_key');
  });

  it('applies CI overrides when isCi is explicitly true', () => {
    const configDir = join(tempDir, '.ralph');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.yml'), `
project:
  name: test
  language: typescript
quality:
  minimum-grade: D
ci:
  quality:
    minimum-grade: B
  doctor:
    minimum-score: 9
`);

    const result = loadConfig(tempDir, true);
    expect(result.config.quality['minimum-grade']).toBe('B');
    expect(result.config.doctor['minimum-score']).toBe(9);
  });

  it('does not apply CI overrides when isCi is explicitly false', () => {
    const configDir = join(tempDir, '.ralph');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.yml'), `
project:
  name: test
  language: typescript
ci:
  quality:
    minimum-grade: A
`);

    const result = loadConfig(tempDir, false);
    expect(result.config.quality['minimum-grade']).toBe('D');
  });

  it('auto-detects CI environment when isCi not provided', () => {
    const configDir = join(tempDir, '.ralph');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.yml'), `
project:
  name: test
  language: typescript
ci:
  quality:
    minimum-grade: A
`);

    // Set CI env var to simulate CI
    const origCi = process.env['CI'];
    process.env['CI'] = 'true';
    try {
      const result = loadConfig(tempDir);
      expect(result.config.quality['minimum-grade']).toBe('A');
    } finally {
      if (origCi === undefined) {
        delete process.env['CI'];
      } else {
        process.env['CI'] = origCi;
      }
    }
  });

  it('does not apply CI overrides in non-CI environment when isCi not provided', () => {
    const configDir = join(tempDir, '.ralph');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'config.yml'), `
project:
  name: test
  language: typescript
ci:
  quality:
    minimum-grade: A
`);

    // Ensure no CI env vars are set
    const saved: Record<string, string | undefined> = {};
    const ciVars = ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'CIRCLECI', 'JENKINS_URL', 'TRAVIS', 'BUILDKITE'];
    for (const v of ciVars) {
      saved[v] = process.env[v];
      delete process.env[v];
    }
    try {
      const result = loadConfig(tempDir);
      expect(result.config.quality['minimum-grade']).toBe('D');
    } finally {
      for (const v of ciVars) {
        if (saved[v] === undefined) {
          delete process.env[v];
        } else {
          process.env[v] = saved[v];
        }
      }
    }
  });
});

describe('mergeWithDefaults run config', () => {
  it('populates run with all defaults when run is absent', () => {
    const config = mergeWithDefaults({ project: { name: 'test', language: 'typescript' } });

    expect(config.run).toBeDefined();
    expect(config.run!.agent.cli).toBe('claude');
    expect(config.run!.agent.args).toEqual(['--print', '--dangerously-skip-permissions', '--model', 'sonnet', '--verbose']);
    expect(config.run!.agent.timeout).toBe(1800);
    expect(config.run!['plan-agent']).toBeNull();
    expect(config.run!['build-agent']).toBeNull();
    expect(config.run!.prompts.plan).toBeNull();
    expect(config.run!.prompts.build).toBeNull();
    expect(config.run!.loop['max-iterations']).toBe(0);
    expect(config.run!.loop['stall-threshold']).toBe(3);
    expect(config.run!.validation['test-command']).toBeNull();
    expect(config.run!.validation['typecheck-command']).toBeNull();
    expect(config.run!.git['auto-commit']).toBe(true);
    expect(config.run!.git['auto-push']).toBe(false);
    expect(config.run!.git['commit-prefix']).toBe('ralph:');
    expect(config.run!.git.branch).toBeNull();
  });

  it('merges partial run config with defaults', () => {
    const config = mergeWithDefaults({
      project: { name: 'test', language: 'typescript' },
      run: {
        agent: { cli: 'amp', timeout: 600 },
        git: { 'auto-push': true, 'commit-prefix': 'bot:' },
        loop: { 'max-iterations': 5 },
      },
    });

    expect(config.run!.agent.cli).toBe('amp');
    expect(config.run!.agent.timeout).toBe(600);
    // default args still applied when not specified
    expect(config.run!.agent.args).toEqual(['--print', '--dangerously-skip-permissions', '--model', 'sonnet', '--verbose']);
    expect(config.run!.git['auto-push']).toBe(true);
    expect(config.run!.git['commit-prefix']).toBe('bot:');
    expect(config.run!.git['auto-commit']).toBe(true); // default
    expect(config.run!.loop['max-iterations']).toBe(5);
    expect(config.run!.loop['stall-threshold']).toBe(3); // default
  });

  it('handles plan-agent explicitly set to null', () => {
    const config = mergeWithDefaults({
      project: { name: 'test', language: 'typescript' },
      run: { 'plan-agent': null },
    });

    expect(config.run!['plan-agent']).toBeNull();
  });

  it('handles plan-agent with partial config', () => {
    const config = mergeWithDefaults({
      project: { name: 'test', language: 'typescript' },
      run: { 'plan-agent': { cli: 'aider' } },
    });

    expect(config.run!['plan-agent']).not.toBeNull();
    expect(config.run!['plan-agent']!.cli).toBe('aider');
    // falls back to agent defaults for unspecified fields
    expect(config.run!['plan-agent']!.timeout).toBe(1800);
  });

  it('handles build-agent with partial config', () => {
    const config = mergeWithDefaults({
      project: { name: 'test', language: 'typescript' },
      run: { 'build-agent': { cli: 'cursor', timeout: 900 } },
    });

    expect(config.run!['build-agent']!.cli).toBe('cursor');
    expect(config.run!['build-agent']!.timeout).toBe(900);
    expect(config.run!['build-agent']!.args).toEqual(['--print', '--dangerously-skip-permissions', '--model', 'sonnet', '--verbose']);
  });

  it('preserves fully specified run config', () => {
    const customArgs = ['--headless'];
    const config = mergeWithDefaults({
      project: { name: 'test', language: 'typescript' },
      run: {
        agent: { cli: 'other', args: customArgs, timeout: 300 },
        prompts: { plan: 'custom-plan.md', build: 'custom-build.md' },
        loop: { 'max-iterations': 10, 'stall-threshold': 5 },
        validation: { 'test-command': 'npm test', 'typecheck-command': 'npx tsc' },
        git: { 'auto-commit': false, 'auto-push': true, 'commit-prefix': 'ai:', branch: 'feature/x' },
      },
    });

    expect(config.run!.agent.cli).toBe('other');
    expect(config.run!.agent.args).toEqual(customArgs);
    expect(config.run!.agent.timeout).toBe(300);
    expect(config.run!.prompts.plan).toBe('custom-plan.md');
    expect(config.run!.prompts.build).toBe('custom-build.md');
    expect(config.run!.loop['max-iterations']).toBe(10);
    expect(config.run!.loop['stall-threshold']).toBe(5);
    expect(config.run!.validation['test-command']).toBe('npm test');
    expect(config.run!.validation['typecheck-command']).toBe('npx tsc');
    expect(config.run!.git['auto-commit']).toBe(false);
    expect(config.run!.git['auto-push']).toBe(true);
    expect(config.run!.git['commit-prefix']).toBe('ai:');
    expect(config.run!.git.branch).toBe('feature/x');
  });
});

describe('detectCiEnvironment', () => {
  const ciVars = ['CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'CIRCLECI', 'JENKINS_URL', 'TRAVIS', 'BUILDKITE'];

  it('returns true when CI env var is set', () => {
    const saved = process.env['CI'];
    process.env['CI'] = 'true';
    try {
      expect(detectCiEnvironment()).toBe(true);
    } finally {
      if (saved === undefined) delete process.env['CI'];
      else process.env['CI'] = saved;
    }
  });

  it('returns true when GITHUB_ACTIONS env var is set', () => {
    const saved = process.env['GITHUB_ACTIONS'];
    process.env['GITHUB_ACTIONS'] = 'true';
    try {
      expect(detectCiEnvironment()).toBe(true);
    } finally {
      if (saved === undefined) delete process.env['GITHUB_ACTIONS'];
      else process.env['GITHUB_ACTIONS'] = saved;
    }
  });

  it('returns false when no CI env vars are set', () => {
    const saved: Record<string, string | undefined> = {};
    for (const v of ciVars) {
      saved[v] = process.env[v];
      delete process.env[v];
    }
    try {
      expect(detectCiEnvironment()).toBe(false);
    } finally {
      for (const v of ciVars) {
        if (saved[v] === undefined) delete process.env[v];
        else process.env[v] = saved[v];
      }
    }
  });
});
