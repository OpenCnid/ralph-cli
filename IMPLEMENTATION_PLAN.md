# Implementation Plan — Trust Calibration Phase 3

Spec: `docs/product-specs/calibration-tracking.md`
Date: 2026-03-13

## Pre-flight
- Regression baseline: 913 tests passing (39 files), typecheck clean
- No pre-existing failures. Proceed directly to implementation.

---

## Schema & Config (F-CT06)
- [x] Add `CalibrationConfig` interface and update `RalphConfig` / `RawRalphConfig` in `src/config/schema.ts`
  Add `CalibrationConfig` with fields `window`, `warn-pass-rate`, `warn-discard-rate`, `warn-volatility`.
  Add `calibration?: CalibrationConfig | undefined` to `RalphConfig`.
  Add `calibration?: Partial<CalibrationConfig>` to `RawRalphConfig`.
  Satisfies AC-8.
  Verify: `npx tsc --noEmit` passes after edit.

- [x] Add `DEFAULT_CALIBRATION` constant to `src/config/defaults.ts`
  ```typescript
  export const DEFAULT_CALIBRATION: CalibrationConfig = {
    window: 30,
    'warn-pass-rate': 0.95,
    'warn-discard-rate': 0.01,
    'warn-volatility': 0.005,
  };
  ```
  Update the import at line 1 to include `CalibrationConfig`.
  Satisfies AC-8.
  Verify: constant is exported and importable.

- [x] Merge calibration defaults in `src/config/loader.ts` and add validation in `src/config/validate.ts`
  In `loader.ts`: import `DEFAULT_CALIBRATION`; in `mergeWithDefaults`, add:
  ```typescript
  calibration: raw.calibration !== undefined
    ? { ...DEFAULT_CALIBRATION, ...raw.calibration }
    : undefined,
  ```
  In `validate.ts`:
  - Add `'calibration'` to `KNOWN_TOP_KEYS`
  - Add `KNOWN_CALIBRATION_KEYS = ['window', 'warn-pass-rate', 'warn-discard-rate', 'warn-volatility']`
  - Add `validateCalibrationConfig()` function called when `obj['calibration']` is present:
    - `window`: must be integer ≥ 5
    - `warn-pass-rate`: must be number in (0, 1]
    - `warn-discard-rate`: must be number in [0, 1)
    - `warn-volatility`: must be number ≥ 0
  Satisfies AC-8 (invalid values rejected, defaults used when absent).
  Verify: `ralph config validate` passes with and without `calibration:` section.

---

## Core Implementation (F-CT01, F-CT02, F-CT04, F-CT07)
- [x] Create `src/commands/score/calibration.ts`
  Exports: `CalibrationReport`, `TrustDriftSignal`, `TrustDriftResult`, `CalibrationThresholds` interfaces;
  `computeCalibration()`, `detectTrustDrift()`, `formatCalibrationReport()`, `formatCalibrationJSON()` functions.

  **`computeCalibration(entries, window)`** (F-CT01, F-CT07):
  - Accepts `ResultEntry[]` and `number`
  - If `entries.length < 5`, return CalibrationReport with `actual: entries.length`, `window`, all rates 0, nulls for conditional metrics — caller checks `actual < 5` for "insufficient data"
  - Pass rate, discard rate, first-try pass rate (heuristic: entry[0] is first-try; entry[i>0] is first-try iff entry[i-1].status === 'pass'), score volatility (population stddev over non-null scores; null if < 2 scored), stall frequency (null if no 'stall' entries), adversarial catch rate (null if no 'adversarial-fail' entries — use `(entry.status as string) === 'adversarial-fail'` with explanatory comment noting Phase 2 type union)
  - `scores` field: raw score array from entries (for sparkline)
  - `partial: boolean` is `entries.length < window` (used by formatter)
  - Satisfies AC-1, AC-6, AC-9.

  **`detectTrustDrift(report, thresholds)`** (F-CT02):
  - 4 candidates: pass rate > warnPassRate, discard rate < warnDiscardRate, volatility < warnVolatility (skip if null), adversarial catch rate === 0 (skip if null)
  - Stall frequency is NOT a drift signal
  - `isDrift = firedSignals.length >= 2`
  - Satisfies AC-2, AC-3.

  **`formatCalibrationReport(report, drift)`**:
  - Outputs multi-line format per spec (F-CT03 "Output Format" section)
  - Header shows "(partial window: N/W)" when `report.actual < report.window`
  - Uses `renderSparkline(report.scores)` from `./trend.js`
  - Trust status: "✓ Normal" or "⚠ Drift (N signals)" with suggested actions on drift
  - Omits adversarial line when `adversarialCatchRate === null`
  - Stall line shows "unavailable (no stall entries recorded)" when `stallFrequency === null`

  **`formatCalibrationJSON(report, drift)`** (F-CT04):
  - Returns object with `calibration`, `trustDrift`, `timestamp` fields
  - Null metrics as JSON null; `partial` field included
  - Insufficient data: `{ calibration: null, error: 'insufficient data', entries: N, minimum: 5 }`
  - Satisfies AC-10.

  Layer rule: imports only from `./results.js`, `./trend.js`, `../../config/schema.js`.
  No imports from run/, lint/, gc/, or other command domains.
  Verify: `npx tsc --noEmit` passes; file is under 500 lines.

---

## CLI Integration (F-CT03, F-CT04)
- [ ] Add `--calibration` flag to `src/commands/score/index.ts` and `src/cli.ts`
  In `src/commands/score/index.ts`:
  - Add `calibration?: boolean | undefined` to `ScoreOptions` interface
  - Import `computeCalibration`, `detectTrustDrift`, `formatCalibrationReport`, `formatCalibrationJSON`, `CalibrationThresholds` from `./calibration.js`
  - Import `DEFAULT_CALIBRATION` from `../../config/defaults.js`
  - In `scoreCommand()`, add calibration branch BEFORE the history/trend checks:
    ```
    if (options.calibration === true) {
      load config (or use defaults); extract thresholds
      readResults(thresholds.window)
      if entries < 5: output.plain('Calibration: insufficient data (N entries, need 5)'); return
      computeCalibration → detectTrustDrift
      if options.json: console.log(JSON.stringify(formatCalibrationJSON(...), null, 2)); return
      output.plain(formatCalibrationReport(...)); return
    }
    ```
  - Exit 0 always (never throw or process.exit(1) from this path)
  Satisfies AC-4, AC-5, AC-10.
  In `src/cli.ts`:
  - Add `.option('--calibration', 'Show calibration metrics and trust drift status')` to the `ralph score` command
  - Add `calibration: options.calibration` to the `scoreCommand({...})` call
  Delegation Safety: both files required — missing either causes silent no-op or type error.
  Verify: `ralph score --calibration` prints formatted report; `ralph score --calibration --json` outputs parseable JSON.

---

## Run Loop Integration (F-CT05)
- [ ] Update `printFinalSummary` in `src/commands/run/progress.ts` and all 9 call sites in `src/commands/run/index.ts`
  In `progress.ts`:
  - Import `computeCalibration`, `detectTrustDrift`, `formatCalibrationReport`, `CalibrationThresholds` from `../score/calibration.js`
  - Import `readResults` from `../score/results.js`
  - Change signature to:
    ```typescript
    export function printFinalSummary(
      reason: string,
      checkpoint: Checkpoint,
      calibrationThresholds?: CalibrationThresholds | undefined,
    ): void
    ```
  - After the existing `output.info('Stop reason: ...')` line, append calibration block:
    - Only when `calibrationThresholds` is provided
    - `readResults(calibrationThresholds.window)` → if entries.length >= 5: compute + detect + print compact line
    - Compact format: `Calibration (last N): pass=X% discard=X% volatility=X.XXX [✓ Normal | ⚠ Drift: ...]`
    - If drift: also print `  ⚠ Trust drift: [signals]. Run ralph score --calibration for details.`
    - If entries < 5: print nothing
  In `src/commands/run/index.ts`:
  - Import `DEFAULT_CALIBRATION` from `../../config/defaults.js`
  - After config is loaded, derive: `const calibrationThresholds = config.calibration ?? DEFAULT_CALIBRATION`
  - All 9 `printFinalSummary(...)` calls gain a third argument: `calibrationThresholds`
  - Call sites are at lines: 293, 341, 431, 468, 472, 1097, 1110, 1114 (and one more — verify with grep)
  Satisfies AC-7.
  CRITICAL: calibration output is purely additive — must NOT affect stop reason, exit code, or loop logic.
  Verify: existing progress tests still pass (no 3rd arg → no calibration output → backward compat).

---

## Architecture Update
- [ ] Update `ARCHITECTURE.md` to add `calibration.ts` to the score domain listing
  In the Directory Map, add under `score/`:
  ```
      │   ├── calibration.ts  — Calibration metrics, trust drift detection, report formatting
      │   └── calibration.test.ts — Unit tests for calibration module
  ```
  Note that `progress.ts` now imports from `../score/calibration.js` and `../score/results.js` —
  this extends the existing documented exception #5 (`run → score`).

---

## Tests
- [ ] Unit tests: `src/commands/score/calibration.test.ts`
  All test cases from spec's Test Plan:
  - `computeCalibration()`: mixed statuses, all-pass, all-fail, exactly 5 entries (minimum), 4 entries (insufficient), stall entries present, adversarial entries present, volatility with all-null scores, volatility with 1 non-null (→ null), volatility with identical scores (→ 0), first-try heuristic (example: pass/pass/fail/pass/pass → 3/4=75%), partial window labeling
  - `detectTrustDrift()`: 0 signals (not drift), 1 signal (not drift), all 6 pairwise 2-signal combinations (all drift), 3 signals, 4 signals, null adversarial rate excluded, null volatility excluded
  - `formatCalibrationReport()`: ✓ Normal state, ⚠ Drift with signal details, partial window label, adversarial line present when data exists / absent when null, stall unavailable label
  - `formatCalibrationJSON()`: `JSON.parse()` succeeds, numeric fields are numbers, null fields are JSON null, insufficient data returns error object
  Satisfies AC-1, AC-2, AC-3, AC-6, AC-9, AC-10 at unit level.

- [ ] Integration tests: extend `src/commands/score/score.test.ts`
  Mock `readResults`, `computeCalibration`, `detectTrustDrift`, `formatCalibrationReport`, `formatCalibrationJSON` from calibration module.
  - `--calibration` flag: `formatCalibrationReport` output appears in stdout
  - `--calibration --json`: stdout is valid JSON
  - `--calibration` with < 5 entries: "insufficient data" message, process exits 0
  - `--calibration` combined with `--history`: calibration branch runs (precedence confirmed)
  Satisfies AC-4, AC-5.

- [ ] Integration tests: extend `src/commands/run/progress.test.ts`
  - `printFinalSummary` with thresholds + ≥5 mock entries → compact calibration line in output
  - `printFinalSummary` with thresholds + < 5 mock entries → no calibration line
  - `printFinalSummary` without thresholds → no calibration line (backward compat)
  Satisfies AC-7, SC-R1 (backward compat).

- [ ] Config tests: extend `src/config/loader.test.ts` and `src/config/validate.test.ts`
  - Full `calibration:` section loads all fields correctly
  - No `calibration:` section → `config.calibration === undefined`
  - Partial calibration config merges with defaults (only `window: 50` → other fields use defaults)
  - Invalid `window: 4` → validation error
  - Invalid `window: 1.5` (non-integer) → validation error
  - Invalid `warn-pass-rate: 1.1` → validation error
  - Invalid `warn-pass-rate: 0` → validation error
  - Invalid `warn-discard-rate: -0.1` → validation error
  - Invalid `warn-volatility: -1` → validation error
  Satisfies AC-8.

---

## Backward Compatibility
- [ ] Verify backward compatibility
  Run `npm test`. Confirm test count ≥ 913 (regression baseline), 0 failures.
  Manually confirm `ralph score`, `ralph score --history`, `ralph score --trend`, `ralph score --compare`, `ralph score --json` produce identical output — none of these code paths are modified.
  Confirm `printFinalSummary` tests without the 3rd argument still pass.
  Satisfies SC-R1.

---

## Verification
- [ ] Run full validation and verify all Phase 3 acceptance criteria
  Run: `npm test && npx tsc --noEmit && ralph doctor --ci && ralph grade --ci`
  Cross-check each AC:
  - AC-1: `computeCalibration()` with ≥5 entries returns correct rates; conditional metrics null when absent — unit tests
  - AC-2: pass rate > 0.95 AND discard rate < 0.01 → `isDrift: true`, both signals named — unit tests
  - AC-3: only pass rate > 0.95 → `isDrift: false` — unit tests
  - AC-4: `ralph score --calibration` prints formatted report with metrics, sparkline, trust status — CLI test
  - AC-5: < 5 entries → "insufficient data (N entries, need 5)", exits 0 — CLI test
  - AC-6: 12 entries with window=30 → "(partial window: 12/30)" — unit test
  - AC-7: run loop prints compact calibration when ≥5 entries; nothing when < 5 — progress tests
  - AC-8: custom thresholds load; defaults when absent; invalid values rejected by `ralph config validate` — config tests
  - AC-9: adversarial-fail entries → catch rate computed; no entries → null and omitted — unit tests
  - AC-10: `ralph score --calibration --json` outputs valid JSON, all fields present, null as JSON null — CLI test
  - SC-R1: ≥913 tests pass; unchanged commands produce identical output
  Confirm sentinel file `src/commands/score/calibration.ts` exists.
