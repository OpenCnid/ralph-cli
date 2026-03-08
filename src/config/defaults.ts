import type { ArchitectureConfig, CoverageConfig, DoctorConfig, DirectionMode, RulesConfig, GcConfig, PathsConfig, QualityConfig, ReferencesConfig } from './schema.js';

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
