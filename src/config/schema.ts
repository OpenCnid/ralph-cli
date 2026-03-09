/**
 * TypeScript types for .ralph/config.yml
 *
 * Every field has a default defined in defaults.ts.
 * The config is the single source of truth for all ralph-cli commands.
 */

export type Language = 'typescript' | 'javascript' | 'python' | 'go' | 'rust' | 'multi';
export type RunnerCli = 'codex' | 'claude' | 'amp' | 'aider' | 'cursor' | 'other';
export type CoverageTool = 'vitest' | 'jest' | 'pytest' | 'go-test' | 'none';
export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface ProjectConfig {
  name: string;
  description?: string | undefined;
  language: Language;
  framework?: string | undefined;
}

export interface RunnerConfig {
  cli?: RunnerCli | undefined;
}

export interface DomainConfig {
  name: string;
  path: string;
}

export interface FileNamingConfig {
  schemas: string;
  types: string;
}

export interface RulesConfig {
  'max-lines': number;
  naming: FileNamingConfig;
}

export type DirectionMode = 'forward-only';

export interface ArchitectureConfig {
  layers: string[];
  direction: DirectionMode;
  domains?: DomainConfig[] | undefined;
  'cross-cutting'?: string[] | undefined;
  rules: RulesConfig;
}

export interface CoverageConfig {
  tool: CoverageTool;
  'report-path': string;
}

export interface QualityConfig {
  'minimum-grade': Grade;
  coverage: CoverageConfig;
}

export interface GcConfig {
  'consistency-threshold': number;
  exclude: string[];
}

export interface DoctorConfig {
  'minimum-score': number;
  'custom-checks': string[];
}

export interface PathsConfig {
  'agents-md': string;
  'architecture-md': string;
  docs: string;
  specs: string;
  plans: string;
  'design-docs': string;
  references: string;
  generated: string;
  quality: string;
}

export interface ReferencesConfig {
  'max-total-kb': number;
  'warn-single-file-kb': number;
}

export interface CiOverrides {
  quality?: Partial<QualityConfig>;
  doctor?: Partial<DoctorConfig>;
}

export interface AgentConfig {
  cli: string;
  args: string[];
  timeout: number;
}

export interface PromptsConfig {
  plan: string | null;
  build: string | null;
}

export interface LoopConfig {
  'max-iterations': number;
  'stall-threshold': number;
}

export interface ValidationConfig {
  'test-command': string | null;
  'typecheck-command': string | null;
}

export interface GitConfig {
  'auto-commit': boolean;
  'auto-push': boolean;
  'commit-prefix': string;
  branch: string | null;
}

export interface RunConfig {
  agent: AgentConfig;
  'plan-agent': AgentConfig | null;
  'build-agent': AgentConfig | null;
  prompts: PromptsConfig;
  loop: LoopConfig;
  validation: ValidationConfig;
  git: GitConfig;
}

export interface ReviewContextConfig {
  'include-specs': boolean;
  'include-architecture': boolean;
  'include-diff-context': number;
  'max-diff-lines': number;
}

export interface ReviewOutputConfig {
  format: 'text' | 'json' | 'markdown';
  file: string | null;
  'severity-threshold': 'info' | 'warn' | 'error';
}

export interface ReviewConfig {
  agent: AgentConfig | null;
  scope: 'staged' | 'commit' | 'range' | 'working';
  context: ReviewContextConfig;
  output: ReviewOutputConfig;
}

export interface HealConfig {
  agent: AgentConfig | null;
  commands: string[];
  'auto-commit': boolean;
  'commit-prefix': string;
}

export interface RalphConfig {
  project: ProjectConfig;
  runner?: RunnerConfig | undefined;
  architecture: ArchitectureConfig;
  quality: QualityConfig;
  gc: GcConfig;
  doctor: DoctorConfig;
  paths: PathsConfig;
  references: ReferencesConfig;
  ci?: CiOverrides | undefined;
  run?: RunConfig | undefined;
  review?: ReviewConfig | undefined;
  heal?: HealConfig | undefined;
}

/**
 * Raw config as parsed from YAML — all fields optional except project.name and project.language.
 */
export interface RawRalphConfig {
  project: {
    name: string;
    description?: string;
    language: Language;
    framework?: string;
  };
  runner?: Partial<RunnerConfig>;
  run?: Partial<{
    agent: Partial<AgentConfig>;
    'plan-agent': Partial<AgentConfig> | null;
    'build-agent': Partial<AgentConfig> | null;
    prompts: Partial<PromptsConfig>;
    loop: Partial<LoopConfig>;
    validation: Partial<ValidationConfig>;
    git: Partial<GitConfig>;
  }>;
  architecture?: Partial<{
    layers: string[];
    direction: DirectionMode;
    domains: DomainConfig[];
    'cross-cutting': string[];
    rules: Partial<{
      'max-lines': number;
      naming: Partial<FileNamingConfig>;
    }>;
  }>;
  quality?: Partial<{
    'minimum-grade': Grade;
    coverage: Partial<CoverageConfig>;
  }>;
  gc?: Partial<{
    'consistency-threshold': number;
    exclude: string[];
  }>;
  doctor?: Partial<{
    'minimum-score': number;
    'custom-checks': string[];
  }>;
  paths?: Partial<PathsConfig>;
  references?: Partial<ReferencesConfig>;
  ci?: CiOverrides;
  review?: Partial<{
    agent: Partial<AgentConfig> | null;
    scope: 'staged' | 'commit' | 'range' | 'working';
    context: Partial<ReviewContextConfig>;
    output: Partial<ReviewOutputConfig>;
  }>;
  heal?: Partial<{
    agent: Partial<AgentConfig> | null;
    commands: string[];
    'auto-commit': boolean;
    'commit-prefix': string;
  }>;
}
