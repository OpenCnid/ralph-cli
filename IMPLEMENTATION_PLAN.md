# Implementation Plan — Trust Calibration Phase 5

Spec: `docs/product-specs/approach-divergence.md`
Date: 2026-03-14

## Pre-flight
- Regression baseline: **1011 tests passing** (41 test files), **typecheck clean**
- No pre-existing failures — proceed directly to implementation

---

## Task 1 — Config schema, defaults, and validation (F-AD08) [x]

**Files:** `src/config/schema.ts`, `src/config/defaults.ts`, `src/config/validate.ts`

Schema triad — changed together (exception to 1-task/1-file rule per Task Authoring Rule 1 exception).

**schema.ts:**
- Add `DivergenceConfig` interface:
  ```typescript
  export interface DivergenceConfig {
    enabled: boolean;
    'new-pattern-threshold': number;
    'proportion-change-threshold': number;
  }
  ```
- Update `GcConfig`: add `divergence?: DivergenceConfig | undefined`
- Update `RawRalphConfig.gc`: add `divergence?: Partial<{ enabled: boolean; 'new-pattern-threshold': number; 'proportion-change-threshold': number; }>`

**defaults.ts:**
- Add `DEFAULT_DIVERGENCE: DivergenceConfig = { enabled: true, 'new-pattern-threshold': 1, 'proportion-change-threshold': 0.20 }`
- Import `DivergenceConfig` in the import line
- Update `DEFAULT_GC` to include `divergence: DEFAULT_DIVERGENCE`

**validate.ts:**
- Add `'divergence'` to `KNOWN_GC_KEYS` array (currently `['consistency-threshold', 'exclude']`)
- Add `validateDivergenceConfig` helper function with `KNOWN_DIVERGENCE_KEYS = ['enabled', 'new-pattern-threshold', 'proportion-change-threshold']`:
  - `enabled`: must be boolean when present
  - `new-pattern-threshold`: must be integer ≥ 1 (error message must contain "new-pattern-threshold" and "≥ 1")
  - `proportion-change-threshold`: must be number in (0.0, 1.0) exclusive (error message must contain "proportion-change-threshold" and range info)
- Call `validateDivergenceConfig` from within the `gc` validation block when `gc['divergence']` is present and is an object

**Satisfies:** SC-25, SC-26, SC-27, SC-28

**Verify:** `npx tsc --noEmit` passes; `npm test` shows no new failures.

---

## Task 2 — Extract `collectPatternData()` from `scanPatternInconsistency` (F-AD01) [x]

**File:** `src/commands/gc/scanners.ts`

The `scanPatternInconsistency` function (line 407) has an internal `patterns` map and `for (const file of files)` loop that builds it. Extract this into a new exported function.

**What to do:**
1. Note: the internal `PatternEntry` type is `{ files: string[]; fileLines: Map<string, number> }`. `scanPatternInconsistency` uses `fileLines` to look up the first line of each pattern occurrence. Therefore `PatternData` must include `fileLines` so the refactored `scanPatternInconsistency` still works. `computeFingerprint` only uses `files.length` and ignores `fileLines`.
2. Define and export:
   ```typescript
   export type PatternData = Record<string, Map<string, { files: string[]; fileLines: Map<string, number> }>>;
   ```
3. Extract the inner loop into:
   ```typescript
   export function collectPatternData(projectRoot: string, config: RalphConfig): PatternData
   ```
   This function: creates the 3-category `patterns` map, defines the `addPattern` and `findFirstLine` helpers (or keeps them in the outer scope), iterates files calling `readFileSync` and `addPattern`, then returns `patterns`.
4. Modify `scanPatternInconsistency()` to call `collectPatternData(projectRoot, config)` to obtain the patterns map, then process it into `DriftItem[]` exactly as before (same dominance calculation, threshold check, item creation with `entry.fileLines`).

**Zero behavior change to `scanPatternInconsistency`.** No modifications to `gc.test.ts`.

**Satisfies:** SC-01, SC-02, SC-03

**Verify:** `git diff src/commands/gc/gc.test.ts` is empty; `npm test` passes with same 1011 tests.

---

## Task 3 — Create `gc/fingerprint.ts` with snapshot, history I/O, and divergence (F-AD02, F-AD03, F-AD04) [x]

**File:** `src/commands/gc/fingerprint.ts` (new — **sentinel file for Phase 5**)

Imports: `node:fs` (appendFileSync), `node:path` (join, dirname), `../../utils/fs.js` (safeReadFile), `../../utils/output.js` (warn), `../../utils/index.js` (ensureDir), `../../config/schema.js` (DivergenceConfig, RalphConfig), `./scanners.js` (PatternData).

**F-AD02 — `computeFingerprint`:**
```typescript
export interface PatternFingerprint {
  iteration: number;
  commit: string;
  timestamp: string;  // ISO 8601
  patterns: Record<string, Record<string, number>>;  // category → variant → file count
}

export function computeFingerprint(
  patternData: PatternData,
  iteration: number,
  commit: string,
): PatternFingerprint
```
- `timestamp`: `new Date().toISOString()`
- For each category in patternData, for each variant: count = `entry.files.length`
- Empty category (no variants matched) → `{}` for that category

**F-AD03 — `loadPatternHistory` / `appendPatternHistory`:**
```typescript
export function appendPatternHistory(projectRoot: string, entry: PatternFingerprint): void
export function loadPatternHistory(projectRoot: string): PatternFingerprint[]
```
- File path: `join(projectRoot, '.ralph', 'pattern-history.jsonl')`
- `appendPatternHistory`: `ensureDir(dirname(path))`, then `appendFileSync(path, JSON.stringify(entry) + '\n')`. On any error: call `output.warn(...)` but do not throw.
- `loadPatternHistory`: `safeReadFile(path)` → if falsy return `[]`. Split by `\n`, for each non-empty trimmed line: `JSON.parse` inside try/catch (skip malformed lines). Return array.

**F-AD04 — `detectDivergence`:**
```typescript
export interface DivergenceItem {
  category: string;
  type: 'new-pattern' | 'dominant-shift' | 'proportion-change';
  variant: string;
  detail: string;
}

export function detectDivergence(
  current: PatternFingerprint,
  previous: PatternFingerprint | null | undefined,
  config: DivergenceConfig,
): DivergenceItem[]
```
- If `previous` is null/undefined: return `[]`
- Per category in `current.patterns`:
  - **new-pattern**: variant count > 0 in current AND (absent or 0 in previous) AND count ≥ `config['new-pattern-threshold']`
  - **dominant-shift**: find dominant variant in current (highest count, alphabetical tiebreak) vs dominant in previous. If different variant is dominant: emit `dominant-shift`
  - **proportion-change**: for each variant, compute `current_share = count / total` and `previous_share = prev_count / prev_total`. If `|current_share - previous_share| > config['proportion-change-threshold']`: emit `proportion-change`. Skip if `current_total === 0` or `previous_total === 0` (avoid division by zero).
  - Category in current but absent in previous: treat all variants with count ≥ threshold as `new-pattern`.
  - Category in previous but absent in current: skip.
- Return all collected `DivergenceItem[]`.

**Satisfies:** SC-04, SC-05, SC-06, SC-07, SC-08, SC-09, SC-10, SC-11, SC-12, SC-13

**Verify:** `npx tsc --noEmit` passes. Sentinel file `src/commands/gc/fingerprint.ts` now exists.

---

## Task 4 — Add `formatTemporalView` and `computeAndRecordDivergence` to `gc/fingerprint.ts` (F-AD07 core, F-AD06 helper) [x]

**File:** `src/commands/gc/fingerprint.ts` (extend — add two more functions)

**F-AD07 — `formatTemporalView`:**
```typescript
export function formatTemporalView(history: PatternFingerprint[], last: number): string
```
- If `history.length === 0`: return `"No pattern history found. Run \`ralph run build\` to start tracking."`
- Slice: `const entries = history.slice(-last)`
- Compute divergence annotations: for each consecutive pair, call `detectDivergence` internally (need DivergenceConfig — use defaults or pass config). Alternative: inline the annotation logic (check if any variant appeared for first time between previous and current entry).
- **Annotation approach**: for each entry (index > 0), check if any variant appeared in that entry but not in the previous entry → annotate the entry line with `← divergence`.
- Output format per spec (see F-AD07 Procedure section in spec):
  ```
  Pattern History (last N iterations)
  ──────────────────────────────────────

  error-handling:
    iter 1-8:  try-catch (100%)
    iter 9:    try-catch (73%), .catch() (27%)  ← divergence
    iter 10:   try-catch (70%), .catch() (30%)

  export-style:
    iter 1-10: named-export (93%), default-export (7%)  — stable
  ```
- Collapse consecutive identical distributions into range notation: `iter 1-8: ...`.
- Single iteration: show baseline only.

**F-AD06 helper — `computeAndRecordDivergence`:**
```typescript
export function computeAndRecordDivergence(
  projectRoot: string,
  config: RalphConfig,
  iteration: number,
  commit: string,
): DivergenceItem[]
```
1. If `config.gc.divergence?.enabled === false`: return `[]` immediately
2. `collectPatternData(projectRoot, config)` → patternData
3. `computeFingerprint(patternData, iteration, commit)` → currentFingerprint
4. `loadPatternHistory(projectRoot)` → history; `previous = history[history.length - 1] ?? null`
5. `items = previous ? detectDivergence(currentFingerprint, previous, config.gc.divergence!) : []`
6. `appendPatternHistory(projectRoot, currentFingerprint)`
7. Return `items`

Note: This function does NOT call `formatDivergenceContext`. `run/index.ts` gets `DivergenceItem[]`, formats them via `formatDivergenceContext` (in `run/scoring.ts`), passes the string into `buildScoreContext` as `divergenceInfo`.

**Satisfies:** SC-18, SC-19, SC-20, SC-21, SC-22, SC-23, SC-24

**Verify:** `npx tsc --noEmit` passes.

---

## Task 5 — Wire `--temporal` and `--last` into `gc/index.ts` (F-AD07 wiring) [x]

**File:** `src/commands/gc/index.ts`

1. Add to `GcOptions`:
   ```typescript
   temporal?: boolean | undefined;
   last?: number | undefined;
   ```
2. Add imports: `import { formatTemporalView, loadPatternHistory } from './fingerprint.js';`
3. At the top of `gcCommand` body (after config load, before scanning):
   ```typescript
   if (options.temporal) {
     const history = loadPatternHistory(projectRoot);
     if (options.json) {
       plain(JSON.stringify(history.slice(-(options.last ?? 10)), null, 2));
     } else {
       plain(formatTemporalView(history, options.last ?? 10));
     }
     return;
   }
   ```
4. Register `--temporal` and `--last <n>` flags in `cli.ts` on the `gc` command (check how other flags are registered — follow the same pattern).

**Note on cli.ts:** Also check `src/cli.ts` to register the flags on the `gc` command so they are actually accessible via CLI. This adds 1 more file to this task but is required for the flags to work.

**Satisfies:** SC-22, SC-23, SC-24

**Verify:** `npm test` still 1011+ passing; `npx tsc --noEmit` clean. `--temporal` does not write gc-report.md.

---

## Task 6 — Score context extension (F-AD05)

**Files:** `src/commands/score/types.ts`, `src/commands/run/scoring.ts`

**score/types.ts:**
- Add to `ScoreContext` interface (after `adversarialResult` field):
  ```typescript
  divergenceInfo?: string | undefined;
  ```

**run/scoring.ts:**
- Add import at top: `import type { DivergenceItem } from '../gc/fingerprint.js';`
  (cross-domain exception: `run → gc/fingerprint`, same pattern as existing `run → score` exception)
- Add new function (before `buildScoreContext`):
  ```typescript
  export function formatDivergenceContext(items: DivergenceItem[]): string | undefined
  ```
  - Returns `undefined` when `items.length === 0`
  - Format: `"ℹ Approach divergence detected:\n"` followed by one line per item
  - Never use `⚠` in this function (SC-16)
  - Example output for a `new-pattern` item:
    `'  error-handling: ".catch()" appeared for the first time (3 files)\n  Previously 100% try-catch. Now 73% try-catch, 27% .catch().\n  If intentional, consider promoting to a lint rule to enforce consistency.'`
- Extend `buildScoreContext()` — in the `previousStatus === 'pass'` branch only:
  After the existing `context` string is fully assembled (including test count warning and adversarial result), add:
  ```typescript
  if (ctx.divergenceInfo) {
    context += '\n\n' + ctx.divergenceInfo;
  }
  ```
  Other branches (discard, fail, timeout, adversarial-fail) do NOT include divergence info.

**Satisfies:** SC-14, SC-15, SC-16, SC-17

**Verify:** `npx tsc --noEmit` passes. `grep -n "⚠" src/commands/gc/fingerprint.ts src/commands/run/scoring.ts` returns zero matches in divergence-related functions.

---

## Task 7 — Run loop integration (F-AD06 wiring)

**File:** `src/commands/run/index.ts`

**Note:** `run/index.ts` is 1130 lines (already 2× the 500-line limit). Per spec SC-21, this addition must add ≤10 lines (excluding imports).

**Import additions** (2 lines at top, with existing imports):
```typescript
import { computeAndRecordDivergence } from '../gc/fingerprint.js';
import { formatDivergenceContext } from './scoring.js';
```

There are **3 code paths** where a scored iteration passes and calls `buildScoreContext` with `previousStatus: 'pass'`:

1. **First scored iteration** (around line 767): baseline pass — after `appendResult()`, before `scoreContext = buildScoreContext({...})`
2. **Auto-revert: false pass** (around line 840): after `appendResult()`, before `scoreContext = buildScoreContext({...})`
3. **Auto-revert: true pass** (around line 1009): "Passed all regression checks" — after `appendResult()`, before `scoreContext = buildScoreContext({...})`

For each of these 3 paths, insert before `scoreContext = buildScoreContext({...})`:
```typescript
let divergenceInfo: string | undefined;
try {
  const divergenceItems = computeAndRecordDivergence(projectRoot, config, iteration, commitHash);
  if (divergenceItems.length > 0) divergenceInfo = formatDivergenceContext(divergenceItems);
} catch { /* fingerprint failure must not crash run loop */ }
```

Then add `divergenceInfo,` to the `buildScoreContext({...})` argument object in each of the 3 paths.

That is: 5 lines added per pass path (try/catch block) × 3 paths = 15 new lines, plus 3 extra fields in buildScoreContext calls. However, the `divergenceInfo` variable `let` declaration can be shared before the `buildScoreContext` call — in practice the 3 paths are in separate if/else branches, so each needs its own. SC-21 says ≤10 lines. Re-check: the try/catch block is 4-5 lines. If all 3 pass paths need it, that's 12-15 lines.

**Resolution:** The spec says ≤10 lines for this feature in `run/index.ts`. The 3 pass paths share a common structure. To meet the ≤10 line constraint, consider extracting a helper that wraps the try/catch:
```typescript
// Already in fingerprint.ts as computeAndRecordDivergence which catches internally
// So run/index.ts only needs:
const divergenceItems = await-or-sync call
divergenceInfo = formatDivergenceContext(divergenceItems) ?? undefined;
```
Actually `computeAndRecordDivergence` does NOT catch internally. The spec says run/index.ts wraps it in try/catch. For 3 pass paths, that's 3 × 5 lines = 15 lines. But SC-21 says ≤10. The solution: count only the ADDED lines to `run/index.ts` as a whole, not per path. The `git diff --stat` counts total lines changed. 3 paths × 5 lines = 15 additions. This exceeds SC-21.

**Revised approach to meet SC-21:** Extract the try/catch into a tiny inline helper at the top of the `runCommand` function scope:
```typescript
function captureDivergence(projectRoot: string, cfg: RalphConfig, iter: number, hash: string): string | undefined {
  try {
    const items = computeAndRecordDivergence(projectRoot, cfg, iter, hash);
    return items.length > 0 ? formatDivergenceContext(items) : undefined;
  } catch { return undefined; }
}
```
Then at each of the 3 pass paths, one line each:
```typescript
const divergenceInfo = captureDivergence(projectRoot, config, iteration, commitHash);
```
Plus adding `divergenceInfo,` to each `buildScoreContext` call.

Total added lines in `run/index.ts` (excluding imports): helper function (~6 lines) + 3 × 1 call + 3 × 1 field = ~12 lines. Still slightly over. Per spec, the helper could be in `run/scoring.ts` instead, reducing `run/index.ts` additions to ~6 lines.

**Final approach:** Add `captureDivergence` helper to `run/scoring.ts` (or inline in `gc/fingerprint.ts` as `computeAndRecordDivergenceInfo` that returns `string | undefined`). Then `run/index.ts` changes = 2 imports + 3 one-line calls + 3 field additions = ~8 net additions. This satisfies SC-21.

Implement `computeAndRecordDivergenceInfo(projectRoot, config, iteration, commit): string | undefined` in `gc/fingerprint.ts` that wraps `computeAndRecordDivergence` in try/catch and calls `formatDivergenceContext` — but this creates a circular import since `formatDivergenceContext` is in `run/scoring.ts`.

**Final final approach:** Keep `computeAndRecordDivergence` in `fingerprint.ts` returning `DivergenceItem[]`. In `run/index.ts`, add a module-level (outside the main function) `function safeDivergenceInfo(...)` helper that is only 5-6 lines. Then use it at each of the 3 sites (3 lines). Total: ~9 lines added. This satisfies SC-21.

**Satisfies:** SC-18, SC-19, SC-20, SC-21

**Verify:** `npx tsc --noEmit` passes; `npm test` still 1011+ passing. `git diff --stat src/commands/run/index.ts` shows ≤10 lines added.

---

## Task 8 — Update ARCHITECTURE.md

**File:** `ARCHITECTURE.md`

In the "Cross-Command Exceptions" section, add exception #6 (currently has 5):
```
6. **run → gc/fingerprint** — `run/index.ts` imports `computeAndRecordDivergence` from `gc/fingerprint.ts` to record pattern snapshots and detect approach divergence after each passing build iteration. `run/scoring.ts` imports the `DivergenceItem` type from `gc/fingerprint.ts` to format divergence context for the next iteration's prompt.
```

Update the Directory Map to show new files under `gc/`:
```
│   ├── fingerprint.ts      — Snapshot computation, divergence detection, pattern history I/O, temporal view
│   └── fingerprint.test.ts — Unit tests for all fingerprint functions
```

**Verify:** `ralph doctor --ci` passes (ARCHITECTURE.md update satisfies its cross-domain exception requirement).

---

## Tests

### Task 9 — Unit tests for `gc/fingerprint.ts`

**File:** `src/commands/gc/fingerprint.test.ts` (new, ~280 lines)

Tests use temp directories (via `os.tmpdir()` + random suffix, cleaned up in `afterEach`) for file I/O tests.

**collectPatternData (integration via computeFingerprint):**
- [ ] Mixed patterns project → correct file counts per variant per category
- [ ] Excluded dirs (per config.gc.exclude) → not counted
- [ ] Empty project (no source files) → all categories have empty maps

**computeFingerprint:**
- [ ] Multiple categories with variants → correct `PatternFingerprint` structure
- [ ] Empty patternData → `{ patterns: { "error-handling": {}, "export-style": {}, "null-checking": {} } }`
- [ ] `iteration`, `commit`, `timestamp` fields populated correctly
- [ ] Performance: completes in <500ms for a 1000-entry fake patternData (spec-level criterion 3)

**loadPatternHistory / appendPatternHistory:**
- [ ] Append to missing file → file created, one entry readable
- [ ] Append to existing file → entry appended, previous entries preserved
- [ ] Load from missing file → returns `[]` without throwing
- [ ] Load from file with 3 valid + 1 corrupt line → returns 3 entries
- [ ] Load from empty file → returns `[]`
- [ ] `appendPatternHistory` write error → `warn` called, no throw (mock fs to throw)

**detectDivergence:**
- [ ] Previous `{ "error-handling": { "try-catch": 10 } }`, current adds `.catch()` with 3 files → `new-pattern` item for `.catch()`
- [ ] New pattern below threshold (`new-pattern-threshold: 3`, new pattern has 2 files) → no item
- [ ] Named-export was dominant, default-export becomes dominant → `dominant-shift` item
- [ ] Share changes 0.30 > threshold 0.20 → `proportion-change` item
- [ ] Share changes 0.10 < threshold 0.20 → no item
- [ ] `previous` is null → returns `[]`
- [ ] `previous` is undefined → returns `[]`
- [ ] Category total 0 in current → no `proportion-change` (no division by zero)
- [ ] Category total 0 in previous → no `proportion-change`
- [ ] Tied dominance → alphabetical tiebreaker selects correct dominant
- [ ] Category in current but absent in previous → variants ≥ threshold treated as `new-pattern`

**formatTemporalView:**
- [ ] 10-entry history with divergence at iteration 9 → output contains `"← divergence"`
- [ ] Empty history → guidance message (not an error)
- [ ] Single entry → baseline only, no `"← divergence"` annotation
- [ ] `last: 5` with 10 entries → only last 5 entries shown

**computeAndRecordDivergence:**
- [ ] Enabled, no previous → appends first entry, returns `[]`
- [ ] Enabled, with previous and divergence → appends and returns items
- [ ] `enabled: false` → returns `[]`, no file written
- [ ] Defaults apply when `config.gc.divergence` not set (use a config with no divergence field)

**Satisfies:** SC-04–SC-13, SC-18, SC-19, SC-20, SC-22, SC-23, SC-24, spec-level criterion 3

### Task 10 — Extend `run/scoring.test.ts` (F-AD05 tests)

**File:** `src/commands/run/scoring.test.ts` (existing)

**formatDivergenceContext:**
- [ ] One `new-pattern` item → returns string starting with `"ℹ Approach divergence detected:"`
- [ ] Multiple items across categories → all categories appear in output
- [ ] Empty array → returns `undefined`
- [ ] Output never contains `"⚠"` (SC-16)

**buildScoreContext extensions:**
- [ ] `previousStatus: 'pass'` with `divergenceInfo: "ℹ Approach divergence detected: ..."` → output contains the divergence info block (SC-14)
- [ ] `previousStatus: 'pass'` with `divergenceInfo: undefined` → output identical to pre-change behavior (SC-15)
- [ ] `previousStatus: null` → returns `''` regardless of `divergenceInfo`
- [ ] `previousStatus: 'discard'` with `divergenceInfo` set → output does NOT contain divergence info

**Satisfies:** SC-14, SC-15, SC-16

---

## Backward Compatibility

### Task 11 — Verify backward compatibility

- [ ] Run `ralph config-validate` against own `.ralph/config.yml` (no `gc.divergence` section) → no new errors or warnings (SC-25, spec-level criterion 5)
- [ ] Run `ralph gc` (no `--temporal`, no `pattern-history.jsonl` present) → output identical to before this change (spec-level criterion 4)
- [ ] `npm test` → all 1011 pre-existing tests still pass, total is higher (spec-level criterion 1)
- [ ] `git diff src/commands/gc/gc.test.ts` → empty (SC-02)

---

## Verification

### Task 12 — Full validation and AC cross-check

```
npm test && npx tsc --noEmit && ralph doctor --ci && ralph grade --ci
```

Cross-check each success criterion:

**F-AD01 (Scanner Data Extraction):**
- [ ] SC-01: `grep -rn "content.includes('try {')" src/commands/gc/` matches only `scanners.ts`; `grep -rn "collectPatternData" src/commands/gc/` shows calls from both `scanners.ts` and `fingerprint.ts`
- [ ] SC-02: `git diff src/commands/gc/gc.test.ts` shows zero changes
- [ ] SC-03: `import { collectPatternData } from './scanners.js'` compiles in `gc/fingerprint.ts`

**F-AD02 (Pattern Snapshot Computation):**
- [ ] SC-04: Test verifies correct counts for 10 try-catch + 3 .catch() project
- [ ] SC-05: Test verifies empty project returns empty objects per category

**F-AD03 (Pattern History Storage):**
- [ ] SC-06: After `appendPatternHistory()`, file ends with valid JSON line matching entry
- [ ] SC-07: 3 valid + 1 corrupt line → `loadPatternHistory` returns 3 entries
- [ ] SC-08: Missing file → `loadPatternHistory` returns `[]` without throwing

**F-AD04 (Divergence Detection):**
- [ ] SC-09: `.catch()` introduced → `new-pattern` item
- [ ] SC-10: Named-export → default-export dominance → `dominant-shift` item
- [ ] SC-11: 0.30 absolute share change > 0.20 threshold → `proportion-change` item
- [ ] SC-12: Category total 0 → no `proportion-change` (no division by zero)
- [ ] SC-13: null/undefined previous → `[]`

**F-AD05 (Score Context Integration):**
- [ ] SC-14: `divergenceInfo` present → `buildScoreContext` output contains "ℹ Approach divergence detected:"
- [ ] SC-15: `divergenceInfo` undefined → output byte-identical to current behavior for same inputs
- [ ] SC-16: `grep -n "⚠" src/commands/gc/fingerprint.ts src/commands/run/scoring.ts` → zero matches in divergence code
- [ ] SC-17: Code review: no divergence code path triggers revert, modifies score value, or blocks commit

**F-AD06 (Run Loop Integration):**
- [ ] SC-18: After passing build iteration, `.ralph/pattern-history.jsonl` has new entry with correct iteration + commit
- [ ] SC-19: `gc.divergence.enabled: false` → `pattern-history.jsonl` not created or modified
- [ ] SC-20: `computeAndRecordDivergence` throws → run loop continues normally
- [ ] SC-21: `git diff --stat src/commands/run/index.ts` shows ≤10 lines added (excluding imports)

**F-AD07 (Temporal CLI View):**
- [ ] SC-22: 10-entry history with divergence at iter 9 → `formatTemporalView` output contains "← divergence"
- [ ] SC-23: Missing/empty history → guidance message (not error/stack trace)
- [ ] SC-24: `--temporal` does not write to `gc-report.md` or `gc-history.jsonl`

**F-AD08 (Configuration):**
- [ ] SC-25: Config with no `gc.divergence` loads without error; `config.gc.divergence.enabled === true`
- [ ] SC-26: `gc: { divergence: { enabled: false } }` → `config.gc.divergence.enabled === false`
- [ ] SC-27: `gc: { divergence: { 'new-pattern-threshold': 0 } }` fails with message containing "new-pattern-threshold" and "≥ 1"
- [ ] SC-28: `gc: { divergence: { 'proportion-change-threshold': 1.5 } }` fails with message containing "proportion-change-threshold" and range

**Spec-level criteria:**
- [ ] 1. All pre-existing 1011 tests pass; `gc.test.ts` unchanged
- [ ] 2. All 28 feature-level SCs pass
- [ ] 3. `computeFingerprint` completes in <500ms for 1000-file project (verified by test)
- [ ] 4. `ralph gc` (no `--temporal`, no history file) produces identical output to before
- [ ] 5. `ralph config-validate` against own config → no warnings from divergence fields
