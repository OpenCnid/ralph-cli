# Implementation Plan — Trust Calibration Phase 5

Spec: `docs/product-specs/approach-divergence.md`
Date: 2026-03-14

## Pre-flight

- Regression baseline: **1011 tests passing** (41 test files), typecheck clean
- No pre-existing failures. Codebase is clean.

---

## Task 1 — Config schema, defaults, validation (F-AD08)

**Files:** `src/config/schema.ts`, `src/config/defaults.ts`, `src/config/validate.ts`

Add `DivergenceConfig` type and wire it into `GcConfig`, `RawRalphConfig`, defaults, and validation.

**schema.ts changes:**
- Add `DivergenceConfig` interface with `enabled: boolean`, `'new-pattern-threshold': number`, `'proportion-change-threshold': number`
- Add `divergence?: DivergenceConfig | undefined` to `GcConfig`
- Add `divergence?: Partial<{...}>` to the `gc` section of `RawRalphConfig`

**defaults.ts changes:**
- Export `DEFAULT_DIVERGENCE: DivergenceConfig = { enabled: true, 'new-pattern-threshold': 1, 'proportion-change-threshold': 0.20 }`
- Update `DEFAULT_GC` to include `divergence: DEFAULT_DIVERGENCE`
- Add `DivergenceConfig` to the import line

**validate.ts changes:**
- Add `'divergence'` to `KNOWN_GC_KEYS`
- Add `KNOWN_DIVERGENCE_KEYS = ['enabled', 'new-pattern-threshold', 'proportion-change-threshold']`
- Add `validateDivergenceConfig()` helper (boolean check, integer ≥ 1, range (0, 1) exclusive)
- Call `validateDivergenceConfig()` from inside the `gc` block when `gc['divergence']` is present

**Verifies:** SC-25, SC-26, SC-27, SC-28
**Verify completion:** `npx tsc --noEmit` passes; config validation tests pass; a config with no `gc.divergence` loads without error; `ralph config-validate` on `.ralph/config.yml` emits no warnings.

---

## Task 2 — Extract `collectPatternData()` from `scanPatternInconsistency()` (F-AD01)

**Files:** `src/commands/gc/scanners.ts`

Extract the internal `patterns` map construction into a new exported function.

**Procedure:**
1. Export a new type:
   ```typescript
   export type PatternData = Record<string, Map<string, { files: string[] }>>;
   ```
2. Extract the `const patterns = {...}` block, the `addPattern` helper, the `findFirstLine` helper, and the file loop (up to but not including the dominance/inconsistency analysis) into:
   ```typescript
   export function collectPatternData(projectRoot: string, config: RalphConfig): PatternData
   ```
3. Refactor `scanPatternInconsistency()` to call `collectPatternData()` for the data, then perform the existing dominance analysis on the result. The `PatternEntry` type (with `fileLines`) must stay in scanners.ts since it is needed for the dominance output — `PatternData` uses `{ files: string[] }` (file-count only, without `fileLines`).

   **Important:** The dominance analysis in `scanPatternInconsistency` uses `entry.fileLines` (for line numbers in output). `collectPatternData` returns only `{ files: string[] }` per the spec's `PatternData` type. To keep zero behavior change: `scanPatternInconsistency` can either still build its own private map with `fileLines`, or `collectPatternData` can return a richer internal type and `scanPatternInconsistency` accesses only `files`. The simplest approach that avoids duplication: keep `collectPatternData` returning `PatternData` (files only), and have `scanPatternInconsistency` do a secondary pass to build `fileLines` for items that exceed threshold — or restructure so `collectPatternData` internally builds a richer map but the exported type only exposes `files`. Either is acceptable; zero behavior change is the constraint.

   **Constraint:** `git diff src/commands/gc/gc.test.ts` must show zero changes after this task.

**Verifies:** SC-01, SC-02, SC-03
**Verify completion:** `grep -rn "content.includes('try {')" src/commands/gc/` matches only `scanners.ts`; all 1011 tests pass unchanged; `collectPatternData` is exported and compiles.

---

## Task 3 — Create `src/commands/gc/fingerprint.ts` — types, snapshot, and history (F-AD02, F-AD03)

**File:** `src/commands/gc/fingerprint.ts` (new)

Implement `PatternFingerprint`, `computeFingerprint()`, `loadPatternHistory()`, `appendPatternHistory()`.

```typescript
export interface PatternFingerprint {
  iteration: number;
  commit: string;
  timestamp: string;  // ISO 8601
  patterns: Record<string, Record<string, number>>;  // category → variant → file count
}
```

**`computeFingerprint(patternData, iteration, commit)`:**
- For each category in `patternData`, for each variant, count = `files.length`
- Empty categories → `{}` per category (not null, not missing)

**`appendPatternHistory(projectRoot, entry)`:**
- Path: `<projectRoot>/.ralph/pattern-history.jsonl`
- Creates `.ralph/` dir if missing (use `ensureDir` from `utils/index.js`)
- Appends JSON line; on error: `output.warn()` but do not throw

**`loadPatternHistory(projectRoot)`:**
- Returns `[]` for missing/empty file
- Skips corrupt JSON lines (same pattern as `gc/history.ts`)

Imports: `collectPatternData` from `./scanners.js`, `ensureDir` from `../../utils/index.js`, `warn` from `../../utils/index.js`, types from `../../config/schema.js`.

**Verifies:** SC-04, SC-05, SC-06, SC-07, SC-08
**Verify completion:** `npx tsc --noEmit` passes; unit tests for these functions pass (Task 7).

---

## Task 4 — Add `detectDivergence()` and `computeAndRecordDivergence()` to `fingerprint.ts` (F-AD04, F-AD06 partial)

**File:** `src/commands/gc/fingerprint.ts`

**`DivergenceItem` interface:**
```typescript
export interface DivergenceItem {
  category: string;
  type: 'new-pattern' | 'dominant-shift' | 'proportion-change';
  variant: string;
  detail: string;
}
```

**`detectDivergence(current, previous, config)`** — detection rules per spec:
- `new-pattern`: variant count > 0 in current, 0/absent in previous, AND count ≥ `config['new-pattern-threshold']`
- `dominant-shift`: variant with highest count changed; ties broken alphabetically
- `proportion-change`: `|current_share - previous_share| > config['proportion-change-threshold']` (absolute, not relative); skip if category total is 0 in either snapshot
- `previous === null/undefined`: return `[]`
- Category in current but absent in previous: all variants with count > 0 → `new-pattern`

**`computeAndRecordDivergence(projectRoot, config, iteration, commit)`:**
- Returns `DivergenceItem[]` (not a formatted string — caller formats)
- Checks `config.gc.divergence?.enabled` — returns `[]` if false or missing
- Calls `collectPatternData` → `computeFingerprint`
- Loads history, takes last entry as `previous`
- If `previous` exists, calls `detectDivergence`
- Appends current fingerprint to history
- Returns divergence items (empty array if none or first iteration)

**Verifies:** SC-09, SC-10, SC-11, SC-12, SC-13, SC-18, SC-19
**Verify completion:** `npx tsc --noEmit` passes; unit tests pass (Task 7).

---

## Task 5 — Add `formatTemporalView()` to `fingerprint.ts` and `--temporal` CLI flag to `gc/index.ts` (F-AD07)

**Files:** `src/commands/gc/fingerprint.ts`, `src/commands/gc/index.ts`

**`formatTemporalView(history, last)`** in `fingerprint.ts`:
- Slices `history` to last `N` entries
- Text output format per spec: category sections, per-iteration lines, `← divergence` annotation when a variant appeared/shifted vs previous entry
- Empty/missing history → guidance message
- `last` default: 10

**`gc/index.ts` changes:**
- Add `temporal?: boolean | undefined` and `last?: number | undefined` to `GcOptions`
- When `options.temporal === true`: load pattern history, call `formatTemporalView`, `plain()` the result, return early (no drift scan, no report write, no history append)
- When `options.temporal === true && options.json === true`: output `JSON.stringify(history.slice(-last), null, 2)`
- Register `--temporal` and `--last <n>` CLI flags in `src/cli.ts` on the `gc` command

**Note:** Also update `src/cli.ts` to register the new options.

**Verifies:** SC-22, SC-23, SC-24
**Verify completion:** `ralph gc --temporal` on a project with no history file prints the guidance message (not a stack trace); `ralph gc --temporal` does not modify `gc-report.md` or `gc-history.jsonl`.

---

## Task 6 — Extend `score/types.ts` and `run/scoring.ts` with divergence context (F-AD05)

**Files:** `src/commands/score/types.ts`, `src/commands/run/scoring.ts`

**`score/types.ts`:**
- Add `divergenceInfo?: string | undefined` to `ScoreContext`

**`run/scoring.ts`:**
- Add import: `import type { DivergenceItem } from '../gc/fingerprint.js'`
- Add `formatDivergenceContext(items: DivergenceItem[]): string | undefined`:
  - Returns `undefined` when items is empty
  - Uses `ℹ` prefix (never `⚠`)
  - Format per spec: one block per category, listing variant/type/detail
- Extend `buildScoreContext()`:
  - In the `previousStatus === 'pass'` branch: when `ctx.divergenceInfo` is a non-empty string, append it after the metrics/reversion line with a blank line separator
  - Other branches: `divergenceInfo` is ignored (no effect on fail/discard/timeout paths)

**Verifies:** SC-14, SC-15, SC-16, SC-17
**Verify completion:** `grep -n "⚠" src/commands/gc/fingerprint.ts src/commands/run/scoring.ts` shows zero matches in divergence code; `buildScoreContext` with no `divergenceInfo` produces byte-identical output to pre-task baseline.

---

## Task 7 — Unit tests for `gc/fingerprint.ts` and extended `run/scoring.test.ts` (F-AD01–F-AD08)

**Files:** `src/commands/gc/fingerprint.test.ts` (new), `src/commands/run/scoring.test.ts` (extended)

**`fingerprint.test.ts`** — cover all functions per spec's Test Plan:

*computeFingerprint:*
- Multiple patterns across categories → correct `PatternFingerprint` structure (SC-04)
- No patterns detected → empty objects per category (SC-05)
- `iteration`, `commit`, `timestamp` populated correctly

*appendPatternHistory / loadPatternHistory:*
- Append to missing file → created with one entry (SC-06)
- Append to existing → entry added, previous preserved
- Load from missing → `[]` without throw (SC-08)
- Load from 3 valid + 1 corrupt line → 3 entries (SC-07)
- Load from empty → `[]`

*detectDivergence:*
- New pattern: previous `{ "error-handling": { "try-catch": 10 } }`, current adds `.catch()` → `new-pattern` (SC-09)
- New pattern below threshold (threshold=3, count=2) → no item
- Dominant shift: `named-export` → `default-export` dominant (SC-10)
- Proportion change 0.90→0.60 with threshold 0.20 → `proportion-change` item (SC-11)
- Proportion change below threshold → no item
- Category total 0 → no `proportion-change` (SC-12)
- `null` previous → `[]` (SC-13)
- Tied dominance with alphabetical tiebreaker
- Category absent in previous → all variants flagged as `new-pattern`

*formatTemporalView:*
- 10 entries with divergence at iter 9 → "← divergence" annotation (SC-22)
- Empty history → guidance message (SC-23)
- Single entry → baseline only
- `last` parameter limits output

*computeAndRecordDivergence:*
- Normal case → appends to history, returns items (SC-18)
- `enabled: false` → returns `[]`, no file written (SC-19)
- Missing config (defaults) → proceeds with defaults

*Performance:*
- `computeFingerprint` completes in <500ms for 1000-file simulation (spec-level criterion 3)

**`run/scoring.test.ts` extensions:**
- `formatDivergenceContext` with one item → "ℹ" string
- `formatDivergenceContext` with multiple items → all listed
- `formatDivergenceContext` with empty → `undefined`
- `buildScoreContext` with `divergenceInfo` → appended after metrics (SC-14)
- `buildScoreContext` without `divergenceInfo` → identical to pre-task output (SC-15)

**Verifies:** All SC-01–SC-28 (unit coverage); spec-level criteria 1, 3
**Verify completion:** `npm test` passes with test count ≥ 1011 + new tests; no existing tests modified.

---

## Task 8 — Wire divergence into `run/index.ts` (F-AD06 complete)

**File:** `src/commands/run/index.ts`

After a passing iteration's score is recorded (`appendResult()`) and before constructing the next iteration's `scoreContext`, add ≤10 lines (excluding imports):

```typescript
// Pattern divergence detection (informational)
let divergenceItems: DivergenceItem[] = [];
try {
  divergenceItems = computeAndRecordDivergence(projectRoot, config, iteration, commitHash ?? captureShortHead());
} catch { /* fingerprint failure must not crash run loop */ }
const divergenceInfo = divergenceItems.length > 0
  ? formatDivergenceContext(divergenceItems)
  : undefined;
```

Pass `divergenceInfo` into each `buildScoreContext()` call in the passing iteration path via `ScoreContext.divergenceInfo`.

Add imports:
- `import { computeAndRecordDivergence } from '../gc/fingerprint.js'`
- `import { formatDivergenceContext } from './scoring.js'`
- `import type { DivergenceItem } from '../gc/fingerprint.js'`

**Placement:** The call must occur AFTER `appendResult()` and before `buildScoreContext()` for the NEXT iteration's context. In the run loop this means after the scored-pass `appendResult` call(s) at lines ~745 and ~820+.

**Constraint:** Addition must be ≤10 lines (excluding imports). All logic lives in helpers (SC-21). The try/catch ensures fingerprint failure never crashes the loop (SC-20).

**Verifies:** SC-18, SC-19, SC-20, SC-21
**Verify completion:** `git diff --stat src/commands/run/index.ts` shows ≤10 added lines (excl. imports); `npm test` still passes; try/catch present in code.

---

## Task 9 — Update `ARCHITECTURE.md` with new cross-domain exception

**File:** `ARCHITECTURE.md`

In the "Cross-Command Exceptions" section, add exception #6:

```
6. **run → gc/fingerprint** — `run/index.ts` imports `computeAndRecordDivergence` from `gc/fingerprint.ts`
   and `run/scoring.ts` imports the `DivergenceItem` type from `gc/fingerprint.ts` to integrate temporal
   pattern divergence detection into the build loop. Follows the existing `run → score` pattern.
```

Also add `gc/fingerprint.ts` to the directory map under `gc/`.

**Verifies:** Spec-level criterion 5 (ARCHITECTURE.md update), cross-domain exception documented
**Verify completion:** `ARCHITECTURE.md` contains "run → gc/fingerprint".

---

## Backward Compatibility

- [ ] Verify backward compatibility
  Run `ralph config-validate` against `.ralph/config.yml` (no `gc.divergence` section). Confirm:
  - No warnings or errors emitted
  - `config.gc.divergence.enabled === true` (default applied)
  - `config.gc.divergence['new-pattern-threshold'] === 1`
  - `config.gc.divergence['proportion-change-threshold'] === 0.20`
  - `ralph gc` (without `--temporal`) produces identical output (test with `ralph gc --json`)
  Compare test count against pre-flight baseline (1011). Any regression is a blocker.

---

## Verification

- [ ] Run full validation and verify all Phase 5 acceptance criteria

  ```
  npm test && npx tsc --noEmit && ralph doctor --ci && ralph grade --ci
  ```

  Cross-check each SC from the spec:

  **F-AD01 Scanner Data Extraction:**
  - SC-01: `grep -rn "content.includes('try {')" src/commands/gc/` matches only `scanners.ts`; `grep -rn "collectPatternData" src/commands/gc/` shows it called from both `scanners.ts` and `fingerprint.ts`
  - SC-02: `git diff src/commands/gc/gc.test.ts` shows zero changes
  - SC-03: `import { collectPatternData } from './scanners.js'` compiles in `fingerprint.ts`

  **F-AD02 Pattern Snapshot Computation:**
  - SC-04: Unit test — 10 try-catch + 3 .catch() files → correct counts
  - SC-05: Unit test — no source files → empty objects per category (not null, not error)

  **F-AD03 Pattern History Storage:**
  - SC-06: After `appendPatternHistory()`, file ends with valid JSON matching entry
  - SC-07: File with 3 valid + 1 corrupt line → exactly 3 entries returned
  - SC-08: Missing file → `[]` without throw

  **F-AD04 Divergence Detection:**
  - SC-09: New `.catch()` pattern detected as `new-pattern`
  - SC-10: Dominant shift from `named-export` to `default-export` detected
  - SC-11: 0.30 absolute share change > 0.20 threshold → `proportion-change`
  - SC-12: Category total 0 → no division by zero, no `proportion-change`
  - SC-13: `null` previous → `[]`

  **F-AD05 Score Context Integration:**
  - SC-14: `divergenceInfo` present → "ℹ Approach divergence detected:" in `buildScoreContext` output
  - SC-15: `divergenceInfo` undefined → byte-identical output to pre-task baseline
  - SC-16: `grep -n "⚠" src/commands/gc/fingerprint.ts src/commands/run/scoring.ts` → 0 matches in divergence code
  - SC-17: Code review — no code path uses divergence to revert, modify score, or block commit

  **F-AD06 Run Loop Integration:**
  - SC-18: After passing build, `.ralph/pattern-history.jsonl` has new entry with correct iteration + commit
  - SC-19: `gc.divergence.enabled: false` → no `pattern-history.jsonl` created/modified
  - SC-20: `computeAndRecordDivergence` throw → loop continues, iteration logged as pass
  - SC-21: `git diff --stat src/commands/run/index.ts` → ≤10 added lines (excl. imports)

  **F-AD07 Temporal CLI View:**
  - SC-22: History with divergence at iter 9 → "← divergence" in `formatTemporalView` output
  - SC-23: Empty/missing history → guidance message (no stack trace)
  - SC-24: `--temporal` doesn't write `gc-report.md` or `gc-history.jsonl`

  **F-AD08 Configuration:**
  - SC-25: No `gc.divergence` → loads clean, defaults applied
  - SC-26: `enabled: false` → loads with `config.gc.divergence.enabled === false`
  - SC-27: `new-pattern-threshold: 0` → validation error containing "new-pattern-threshold" and "≥ 1"
  - SC-28: `proportion-change-threshold: 1.5` → validation error containing range

  **Spec-level criteria:**
  1. All pre-existing 1011 tests pass + new tests added; `git diff src/commands/gc/gc.test.ts` = empty
  2. All 28 SC pass (see above)
  3. `computeFingerprint` completes in <500ms for 1000-file project (timing test in fingerprint.test.ts)
  4. `ralph gc` (no `--temporal`) produces identical output on a project with no pattern history file
  5. `.ralph/config.yml` with no `gc.divergence` → `ralph config-validate` clean
