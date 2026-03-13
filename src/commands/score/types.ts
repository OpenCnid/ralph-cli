/** Result from running a score script or the default scorer. */
export interface ScoreResult {
  score: number | null;        // 0.0–1.0, null if scoring failed/unavailable
  source: 'script' | 'default'; // which scorer produced this result
  scriptPath: string | null;   // path to score script (null for default scorer)
  metrics: Record<string, string>; // key-value pairs from scorer output
  error?: string | undefined;  // error message if scoring failed
}

/** Single row in .ralph/results.tsv. */
export interface ResultEntry {
  commit: string;              // short hash of HEAD
  iteration: number;           // 1-indexed
  status: 'pass' | 'fail' | 'timeout' | 'discard' | 'adversarial-fail';
  score: number | null;        // null rendered as '—' in TSV
  delta: number | null;        // null rendered as '—' in TSV
  durationS: number;           // wall-clock seconds
  metrics: string;             // raw key=value string, or '—'
  description: string;         // commit message or '—'
  stages?: string | undefined; // "name:pass,name:fail" or undefined
}

/** Scoring state passed to prompt generation for {score_context}. */
export interface ScoreContext {
  previousStatus: 'pass' | 'fail' | 'timeout' | 'discard' | 'adversarial-fail' | null;
  previousScore: number | null;
  currentScore: number | null;
  delta: number | null;
  metrics: string;             // raw key=value string
  changedMetrics: string;      // human-readable diff of changed metrics
  timeoutSeconds: number;      // iteration-timeout value (for timeout context)
  regressionThreshold: number; // for "regressions beyond X" message
  previousTestCount: number | null; // for test count monitoring
  currentTestCount: number | null;  // for test count monitoring
  failedStage: string | null;       // name of failed stage, null if passed or no stages
  stageResults: string | null;      // "unit:pass,typecheck:pass,integration:fail" or null
  adversarialResult?: import('../run/types.js').AdversarialResult | null | undefined;
}
