# Implementation Plan — Trust Calibration Phase 3

Spec: `docs/product-specs/calibration-tracking.md`
Date: 2026-03-13

## Pre-flight

- Regression baseline: **913 tests passing** (39 test files), typecheck clean
- No pre-existing validation failures.

> Note: `ResultEntry.status` already includes `'adversarial-fail'` in `types.ts` (added in Phase 2). The
> spec's note about requiring a type assertion (`as string`) for adversarial-fail comparisons is obsolete —
> use a normal string comparison. This simplifies F-CT07 implementation.

---

## Schema & Config (Task 1 of 2)

- [ ] Add `CalibrationConfig` to `src/config/schema.ts`, add `DEFAULT_CALIBRATION` to
  `src/config/defaults.ts`, and merge calibration in `src/config/loader.ts`

  **schema.ts changes:**
  - Add `CalibrationConfig` interface (4 fields: `window`, `warn-pass-rate`, `warn-discard-rate`,
    `warn-volatility`)
  - Add `calibration?: CalibrationConfig | undefined` to `RalphConfig`
  - Add `calibration?: Partial<CalibrationConfig>` to `RawRalphConfig`

  **defaults.ts changes:**
  - Add `import { ..., CalibrationConfig } from './schema.js'` to import line
  - Export `DEFAULT_CALIBRATION: CalibrationConfig` with values from spec (window=30,
    warn-pass-rate=0.95, warn-discard-rate=0.01, warn-volatility=0.005)

  **loader.ts changes:**
  - Add `DEFAULT_CALIBRATION` to the import from `./defaults.js`
  - Add calibration merge to `mergeWithDefaults()` following the `scoring` pattern:
    ```typescript
    calibration: raw.calibration !== undefined ? {
      window: raw.calibration.window ?? DEFAULT_CALIBRATION.window,
      'warn-pass-rate': raw.calibration['warn-pass-rate'] ?? DEFAULT_CALIBRATION['warn-pass-rate'],
      'warn-discard-rate': raw.calibration['warn-discard-rate'] ?? DEFAULT_CALIBRATION['warn-discard-rate'],
      'warn-volatility': raw.calibration['warn-volatility'] ?? DEFAULT_CALIBRATION['warn-volatility'],
    } : undefined,
    ```

  **Verify:** `npx tsc --noEmit` passes. Satisfies F-CT06 (partial — validation in next task).

## Schema & Config (Task 2 of 2)

- [ ] Add calibration validation to `src/config/validate.ts`

  - Add `'calibration'` to `KNOWN_TOP_KEYS` array
  - Add `KNOWN_CALIBRATION_KEYS = ['window', 'warn-pass-rate', 'warn-discard-rate', 'warn-volatility']`
    constant near the other `KNOWN_*` constants
  - Add a `validateCalibrationConfig()` block in the `validate()` function following the pattern of
    existing optional sections (check `obj['calibration'] !== undefined`, guard type, call
    `warnUnknownKeys`, then validate each field):
    - `window`: integer ≥ 5
    - `warn-pass-rate`: number in (0, 1]
    - `warn-discard-rate`: number in [0, 1)
    - `warn-volatility`: number ≥ 0

  **Verify:** `npx tsc --noEmit` passes. `ralph config validate` passes with and without `calibration:`
  section. Invalid `window: -1` produces a validation error. Satisfies AC-8 (validation part).

---

## Core Implementation

- [ ] Create `src/commands/score/calibration.ts` with all exports

  **Types to export:** `CalibrationReport`, `TrustDriftSignal`, `TrustDriftResult`,
  `CalibrationThresholds`

  **`computeCalibration(entries, window)`:**
  - Slice to `entries.slice(-window)` to get the rolling window
  - If `actual < 5`, return a sentinel report (set `actual` to entries.length, all metrics 0/null,
    caller detects insufficient data by checking `actual < 5`)
  - Compute pass rate, discard rate, adversarial catch rate, first-try pass rate, score volatility,
    stall frequency using exact formulas from spec (F-CT01 Procedure section)
  - Adversarial catch rate: check `(entry.status as string) === 'adversarial-fail'` — NOTE: per the
    Phase 2 pre-flight note above, the type union already includes `'adversarial-fail'`, so use
    `entry.status === 'adversarial-fail'` directly (no cast needed)
  - Standard deviation: population stddev (`Math.sqrt(sum((x - mean)^2) / n)`)
  - Return `CalibrationReport` with `window` (configured), `actual` (window.length), and all metric fields

  **`detectTrustDrift(report, thresholds)`:**
  - Check 4 signals per F-CT02 Procedure (pass rate `>`, discard rate `<`, volatility `<`, adversarial = 0%)
  - Null metrics are excluded (not counted as fired or not-fired)
  - `isDrift = signals.length >= 2`
  - Each fired signal produces a `TrustDriftSignal` with name, value (formatted string), threshold
    (formatted string), and interpretation text

  **`formatCalibrationReport(report, drift)`:**
  - Returns a multi-line string matching the output template in F-CT03
  - Uses `renderSparkline()` from `./trend.js` for score trend line
  - Uses "partial window" label when `report.actual < report.window`
  - Stall frequency line: "unavailable (no stall entries recorded)" when `report.stallFrequency === null`
  - Adversarial line: omitted entirely when `report.adversarialCatchRate === null`
  - Trust status section: "✓ Normal" or "⚠ Drift (N signals)" with suggested actions on drift

  **`formatCalibrationJSON(report, drift)`:**
  - Returns an object matching the JSON schema in F-CT04
  - Includes `calibration` (all report fields + `partial` boolean), `trustDrift`, and `timestamp`
  - `null` fields are JSON null (not omitted)

  **Imports allowed:** `./results.js` (readResults), `./types.js` (ResultEntry), `./trend.js`
  (renderSparkline), `../../config/schema.js` (CalibrationConfig). No imports from `run/` or other
  command domains.

  **Verify:** `npx tsc --noEmit` passes. Satisfies AC-1 (computation), AC-2 (drift 2 signals), AC-3
  (single signal not drift), F-CT07 (adversarial-aware), F-CT04 format.

---

## CLI Integration

- [ ] Add `--calibration` flag to `src/commands/score/index.ts` and `src/cli.ts`

  **index.ts changes:**
  - Add `calibration?: boolean | undefined` to `ScoreOptions` interface
  - Add calibration branch at the top of `scoreCommand()`, before the config load (or after — see
    spec note: `--calibration` takes precedence over `--history` and `--trend`):
    ```typescript
    if (options.calibration === true) {
      // load config (or use defaults)
      const thresholds = config?.calibration ?? DEFAULT_CALIBRATION;
      const entries = readResults(thresholds.window);
      if (entries.length < 5) {
        output.plain(`Calibration: insufficient data (${entries.length} entries, need 5)`);
        return;
      }
      const report = computeCalibration(entries, thresholds.window);
      const drift = detectTrustDrift(report, toCalibrationThresholds(thresholds));
      if (options.json === true) {
        console.log(JSON.stringify(formatCalibrationJSON(report, drift), null, 2));
        return;
      }
      output.plain(formatCalibrationReport(report, drift));
      return;
    }
    ```
  - Add import for `computeCalibration`, `detectTrustDrift`, `formatCalibrationReport`,
    `formatCalibrationJSON` from `./calibration.js`
  - Add `DEFAULT_CALIBRATION` import from `../../config/defaults.js`
  - The config load in this branch: reuse the existing `loadConfig()` call that already exists later in
    `scoreCommand()` — hoist it or call it early. Simplest: load config early, then branch on all options.
    Alternatively, load config only when `options.calibration` is true.
  - For the JSON insufficient-data case, output:
    `console.log(JSON.stringify({ calibration: null, error: 'insufficient data', entries: N, minimum: 5 }, null, 2))`

  **cli.ts changes:**
  - Add `.option('--calibration', 'Show calibration metrics and trust drift status')` to the `score`
    command (before `.action(...)`)
  - Add `calibration?: boolean` to the options type in the `.action()` handler
  - Pass `calibration: options.calibration` in the `scoreCommand({...})` call

  **Verify:** `npx tsc --noEmit` passes. `ralph score --calibration` produces formatted output. Satisfies
  AC-4 (CLI output), AC-5 (insufficient data), AC-6 (partial window), AC-10 (JSON output), F-CT03, F-CT04.

---

## Run Loop Integration

- [ ] Add optional calibration parameter to `printFinalSummary` in `src/commands/run/progress.ts` and
  update call sites in `src/commands/run/index.ts`

  **progress.ts changes:**
  - Add imports: `readResults` from `../score/results.js`, `computeCalibration`, `detectTrustDrift`,
    `formatCalibrationReport` from `../score/calibration.js`, `DEFAULT_CALIBRATION` from
    `../../config/defaults.js`, `CalibrationConfig` from `../../config/schema.js`
  - Change `printFinalSummary` signature to:
    ```typescript
    export function printFinalSummary(
      reason: string,
      checkpoint: Checkpoint,
      calibrationConfig?: CalibrationConfig | undefined,
    ): void
    ```
  - After the existing `output.info('Stop reason: ...')` line, add the calibration block:
    - If `calibrationConfig === undefined`, do nothing (backward compatible)
    - Otherwise: `const entries = readResults(calibrationConfig.window)`
    - If `entries.length < 5`, print nothing (per spec — don't clutter short runs)
    - Otherwise: compute calibration and drift, print compact format:
      `Calibration (last N): pass=X% discard=Y% volatility=Z ✓ Normal`
      or with drift warning line

  **run/index.ts changes:**
  - The file already loads config via `loadConfig()` at the top of `runCommand()`. Ensure
    `config.calibration` is available at the point of each `printFinalSummary` call.
  - Update all `printFinalSummary(reason, checkpoint)` call sites (lines 293, 341, 431, 468, 472, 1097,
    1110, 1114) to:
    `printFinalSummary(reason, checkpoint, config.calibration)`

  **Verify:** `npx tsc --noEmit` passes. Run loop tests confirm calibration line appears when ≥5 entries.
  Callers without 3rd arg still work identically. Satisfies AC-7 (run loop integration).

---

## Tests

- [ ] Create `src/commands/score/calibration.test.ts` — unit tests for all exports

  Tests to include (per spec test plan):

  **`computeCalibration()`:**
  - Window of 30 mixed-status entries → correct pass rate, discard rate, first-try pass rate, volatility
  - All-pass entries (100% pass rate)
  - All-fail entries (0% pass rate)
  - Exactly 5 entries → computes (minimum threshold)
  - 4 entries → `actual < 5` (insufficient data sentinel)
  - All scores identical → volatility = 0
  - Two scored entries → volatility computed
  - All scores null → `scoreVolatility = null`
  - One non-null score → `scoreVolatility = null` (need ≥ 2)
  - First-try heuristic: entries [pass, pass, fail, fail, pass] → verify 3/4 = 75% (see spec derivation)
  - `adversarial-fail` entries present → catch rate computed
  - No `adversarial-fail` entries → `adversarialCatchRate = null`
  - Stall entries present → stall frequency computed
  - No stall entries → `stallFrequency = null`
  - Window larger than available data → uses all available (partial window)

  **`detectTrustDrift()`:**
  - 0 signals → `isDrift: false`
  - 1 signal (high pass rate only) → `isDrift: false`
  - 2 signals (high pass + low discard) → `isDrift: true`, 2 signals returned
  - All 6 pairwise combinations of 4 signals → each returns `isDrift: true`
  - 3 signals → `isDrift: true`
  - 4 signals → `isDrift: true`
  - `adversarialCatchRate = null` → adversarial signal excluded (not counted)
  - `scoreVolatility = null` → volatility signal excluded
  - Adversarial catch rate = 0% with data present → signal fires

  **`formatCalibrationReport()`:**
  - Normal state → includes "✓ Normal"
  - Drift state → includes "⚠ Drift" + signal details + suggested actions
  - Partial window (actual < window) → includes "(partial window: N/W)"
  - Adversarial data present → adversarial catch rate line shown
  - Adversarial data absent → no adversarial line
  - Stall absent → "unavailable" label

  **`formatCalibrationJSON()`:**
  - Output `JSON.parse()`s without error
  - All numeric fields are numbers
  - Null fields serialize as JSON `null` (not omitted)
  - `partial` boolean correct (true when actual < window)

  **Verify:** `npm test` adds ≥ 30 new unit tests. Satisfies AC-1, AC-2, AC-3, AC-9.

- [ ] Extend existing test files for CLI, config, and run loop

  **`src/commands/score/score.test.ts` (or cli.test.ts):**
  - `--calibration` flag calls calibration path and produces formatted output
  - `--calibration --json` produces valid JSON
  - `--calibration` with insufficient data prints "insufficient data" message and exits 0
  - `--calibration` with `--history` flag → calibration takes precedence

  **`src/commands/run/progress.test.ts`:**
  - `printFinalSummary` with `calibrationConfig` and ≥5 results entries → compact calibration line printed
  - `printFinalSummary` with `calibrationConfig` and <5 entries → no calibration output
  - `printFinalSummary` without `calibrationConfig` → no calibration output (backward compatible)

  **`src/config/loader.test.ts`:**
  - Config with `calibration:` section loads correctly with correct field values
  - Config without `calibration:` → `config.calibration` is `undefined`
  - Partial calibration config (only `window: 50`) → only `window` overridden, rest are defaults

  **`src/config/validate.test.ts`:**
  - Invalid `window: 4` (< 5) → validation error
  - Invalid `warn-pass-rate: 1.1` (> 1) → validation error
  - Invalid `warn-pass-rate: 0` (not > 0) → validation error
  - Invalid `warn-volatility: -0.1` (< 0) → validation error
  - Unknown calibration key → warning

  **Verify:** `npm test` passes, test count increases by ≥ 10 additional tests. Satisfies AC-8 (config
  tests), AC-4/AC-5 (CLI tests), AC-7 (run loop tests).

---

## Backward Compatibility

- [ ] Verify backward compatibility against regression baseline

  Run `npm test && npx tsc --noEmit` and confirm:
  - Test count ≥ 913 + new tests (no test regressions)
  - Typecheck clean
  - `ralph score` (no flags) produces identical output to before this change
  - `ralph score --history` works unchanged
  - `ralph score --trend` works unchanged
  - `ralph score --compare` works unchanged
  - `ralph score --json` (without `--calibration`) works unchanged
  - `ralph config validate` passes with a config that has no `calibration:` section
  - `printFinalSummary` called without 3rd param produces identical output to before

  Satisfies SC-R1.

---

## Architecture Update

- [ ] Update `ARCHITECTURE.md` score domain listing

  - Add `calibration.ts` and `calibration.test.ts` to the score domain listing in the Directory Map
  - The existing `run → score` cross-command exception (item 5) already covers this; add a note that it
    now also includes `computeCalibration`, `detectTrustDrift`, `formatCalibrationReport` from
    `calibration.ts`

---

## Verification

- [ ] Run full validation and verify all Phase 3 acceptance criteria

  ```
  npm test && npx tsc --noEmit
  ```

  Cross-check each AC from the spec:

  - **AC-1: Calibration computation from results.tsv** — verify `computeCalibration()` returns all
    six metrics for a known dataset with ≥5 entries; adversarial catch rate and stall frequency only
    when corresponding status entries exist
  - **AC-2: Trust drift detection (multi-signal)** — verify pass rate > 0.95 AND discard rate < 0.01
    returns `isDrift: true` with both signals named
  - **AC-3: Single signal is not drift** — verify pass rate > 0.95 only returns `isDrift: false`
  - **AC-4: CLI output** — `ralph score --calibration` prints formatted report with metrics, sparkline,
    trust status
  - **AC-5: Insufficient data** — `ralph score --calibration` with < 5 entries prints "insufficient
    data (N entries, need 5)"
  - **AC-6: Partial window** — with 12 entries, window=30, report labeled "(partial window: 12/30)"
  - **AC-7: Run loop integration** — `printFinalSummary` with ≥5 entries prints compact calibration
    line; with < 5 entries nothing printed
  - **AC-8: Configurable thresholds** — custom thresholds load from config; missing config uses
    defaults; invalid values rejected by `ralph config validate`
  - **AC-9: Adversarial-aware (conditional)** — with `adversarial-fail` entries, rate computed; without,
    metric is `null` and omitted
  - **AC-10: JSON output** — `ralph score --calibration --json` outputs valid JSON matching F-CT04
    schema; null fields are JSON null
  - **SC-R1: Regression** — all pre-existing tests pass; existing score/run commands unaffected

  Sentinel check: confirm `src/commands/score/calibration.ts` exists.
