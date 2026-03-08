export { loadConfig, findConfigFile, findProjectRoot, mergeWithDefaults } from './loader.js';
export type { LoadResult } from './loader.js';
export { validate } from './validate.js';
export type { ValidationResult } from './validate.js';
export type {
  RalphConfig,
  RawRalphConfig,
  ProjectConfig,
  RunnerConfig,
  ArchitectureConfig,
  QualityConfig,
  GcConfig,
  DoctorConfig,
  PathsConfig,
  ReferencesConfig,
  CiOverrides,
  Language,
  RunnerCli,
  CoverageTool,
  Grade,
  DomainConfig,
  FilesConfig,
  FileNamingConfig,
  CoverageConfig,
} from './schema.js';
export {
  DEFAULT_ARCHITECTURE,
  DEFAULT_DOCTOR,
  DEFAULT_GC,
  DEFAULT_PATHS,
  DEFAULT_QUALITY,
  DEFAULT_REFERENCES,
  DEFAULT_LAYERS,
  DEFAULT_FILES,
} from './defaults.js';
