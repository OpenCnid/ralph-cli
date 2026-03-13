import type { AdversarialConfig, AgentConfig, ArchitectureConfig, CalibrationConfig, CoverageConfig, DoctorConfig, DirectionMode, GitConfig, HealConfig, LoopConfig, PromptsConfig, RunConfig, ReviewConfig, RulesConfig, GcConfig, PathsConfig, QualityConfig, ReferencesConfig, ScoringConfig, ValidationConfig } from './schema.js';

export const DEFAULT_LAYERS: string[] = ['types', 'config', 'data', 'service', 'ui'];

export const DEFAULT_DIRECTION: DirectionMode = 'forward-only';

export const DEFAULT_RULES: RulesConfig = {
  'max-lines': 500,
  naming: {
    schemas: '*Schema',
    types: '*Type',
  },
};

export const DEFAULT_ARCHITECTURE: Omit<ArchitectureConfig, 'domains' | 'cross-cutting'> = {
  layers: DEFAULT_LAYERS,
  direction: DEFAULT_DIRECTION,
  rules: DEFAULT_RULES,
};

export const DEFAULT_COVERAGE: CoverageConfig = {
  tool: 'none',
  'report-path': 'coverage/lcov.info',
};

export const DEFAULT_QUALITY: QualityConfig = {
  'minimum-grade': 'D',
  coverage: DEFAULT_COVERAGE,
};

export const DEFAULT_GC: GcConfig = {
  'consistency-threshold': 60,
  exclude: ['node_modules', 'dist', '.next', 'coverage'],
};

export const DEFAULT_DOCTOR: DoctorConfig = {
  'minimum-score': 7,
  'custom-checks': [],
};

export const DEFAULT_PATHS: PathsConfig = {
  'agents-md': 'AGENTS.md',
  'architecture-md': 'ARCHITECTURE.md',
  docs: 'docs',
  specs: 'docs/product-specs',
  plans: 'docs/exec-plans',
  'design-docs': 'docs/design-docs',
  references: 'docs/references',
  generated: 'docs/generated',
  quality: 'docs/QUALITY_SCORE.md',
};

export const DEFAULT_REFERENCES: ReferencesConfig = {
  'max-total-kb': 200,
  'warn-single-file-kb': 80,
};

export const DEFAULT_AGENT: AgentConfig = {
  cli: 'claude',
  args: ['--print', '--dangerously-skip-permissions', '--model', 'sonnet', '--verbose'],
  timeout: 1800,
};

const DEFAULT_PROMPTS: PromptsConfig = {
  plan: null,
  build: null,
};

export const DEFAULT_SCORING: ScoringConfig = {
  script: null,
  'regression-threshold': 0.02,
  'cumulative-threshold': 0.10,
  'auto-revert': true,
  'default-weights': {
    tests: 0.6,
    coverage: 0.4,
  },
};

const DEFAULT_LOOP: LoopConfig = {
  'max-iterations': 0,
  'stall-threshold': 3,
  'iteration-timeout': 900,
};

const DEFAULT_VALIDATION: ValidationConfig = {
  'test-command': null,
  'typecheck-command': null,
};

const DEFAULT_GIT: GitConfig = {
  'auto-commit': true,
  'auto-push': false,
  'commit-prefix': 'ralph:',
  branch: null,
};

export const DEFAULT_ADVERSARIAL: AdversarialConfig = {
  enabled: false,
  agent: null,
  model: null,
  budget: 5,
  timeout: 300,
  'diagnostic-branch': true,
  'test-patterns': [
    '**/*.test.{ts,js,tsx,jsx}',
    '**/*.spec.{ts,js,tsx,jsx}',
    '**/test_*.py',
    '**/*_test.py',
    '**/*_test.go',
  ],
  'restricted-patterns': [
    'IMPLEMENTATION_PLAN.md',
    '.ralph/**',
    'package.json',
    'tsconfig.json',
  ],
  'skip-on-simplify': true,
};

export const DEFAULT_RUN: RunConfig = {
  agent: DEFAULT_AGENT,
  'plan-agent': null,
  'build-agent': null,
  prompts: DEFAULT_PROMPTS,
  loop: DEFAULT_LOOP,
  validation: DEFAULT_VALIDATION,
  git: DEFAULT_GIT,
  adversarial: DEFAULT_ADVERSARIAL,
};

export const DEFAULT_HEAL: HealConfig = {
  agent: null,
  commands: ['doctor', 'grade', 'gc', 'lint'],
  'auto-commit': true,
  'commit-prefix': 'ralph: heal',
};

export const DEFAULT_CALIBRATION: CalibrationConfig = {
  window: 30,
  'warn-pass-rate': 0.95,
  'warn-discard-rate': 0.01,
  'warn-volatility': 0.005,
};

export const DEFAULT_REVIEW: ReviewConfig = {
  agent: null,
  scope: 'staged',
  context: {
    'include-specs': true,
    'include-architecture': true,
    'include-diff-context': 5,
    'max-diff-lines': 2000,
  },
  output: {
    format: 'text',
    file: null,
    'severity-threshold': 'info',
  },
};
