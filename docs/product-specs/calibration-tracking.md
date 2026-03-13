# Spec: Calibration Tracking

**Version:** 0.7.0-r1
**Status:** Draft (revised)
**Date:** 2026-03-13
**Roadmap:** Trust Calibration Phase 3
**Revision:** Pre-implementation hardening. See `calibration-tracking-revision.md` for full analysis.

---

## Problem Statement

Ralph tracks iteration outcomes (pass, fail, discard, timeout) in `results.tsv` and computes score trends via sparklines. But it never asks the meta-question: **is ralph's own validation trustworthy?**

A high pass rate feels good. 95% of iterations pass validation — the agent is doing great, the project is on track. But a high pass rate can also mean:

1. **Validation isn't catching enough.** Tests are too lenient. The grade threshold is too low. The lint rules are too permissive. Bugs are passing through.
2. **The work is trivially easy.** The implementation plan has tasks so small that failure is nearly impossible. The harness is working but not being stressed.
3. **Trust drift.** When output is consistently good, humans stop reviewing carefully. The 5% that fails is where the critical bugs hide, and nobody is looking closely because the baseline is so strong.

**Quantified impact of gaps in the original draft:** 3 of 6 proposed metrics (adversarial catch rate, first-try pass rate, stall frequency) relied on data not present in the current `results.tsv` schema. This revision resolves all three: adversarial catch rate is conditional on Phase 2, first-try pass rate uses a computable heuristic, and stall frequency requires a documented prerequisite.

**Root cause:** The original spec was drafted with the assumption that Phases 1-2 (staged validation + adversarial generation) would be complete before calibration was built. In practice, calibration may be implemented with partial upstream availability. This revision makes every metric independently functional, degrading gracefully when upstream data is absent.

---

## Design Principles

1. **Read-only.** Calibration reads from `results.tsv`. It never writes to it, never modifies scores, never halts the loop. It is purely informational.
2. **Graceful degradation.** Every metric works with the data available. Missing adversarial entries? Omit adversarial catch rate. No stall entries? Report stall frequency as "unavailable." Below window size? Compute partial with a disclaimer.
3. **No new data formats.** Calibration does not introduce new files, new TSV columns, or new log formats. It computes derived metrics from existing ResultEntry data.
4. **Additive only.** No existing command behavior changes. `ralph score` without `--calibration` works identically to v0.5.

---

## Definitions

| Term | Definition |
|------|------------|
| **Calibration** | The measurement of how well ralph's validation outcomes (pass/fail/discard) correspond to actual code correctness. A well-calibrated harness has pass rates that reflect real quality, not lenient gates. |
| **Trust drift** | A state where validation consistently reports success while actual quality may be declining. Detected when 2 or more calibration signals simultaneously exceed their thresholds. |
| **Rolling window** | The last N entries in `.ralph/results.tsv`, regardless of which `ralph run` invocation produced them. Default N = 30. |
| **Pass rate** | Count of entries with `status = 'pass'` divided by total entries in the window. Range: 0.0–1.0. |
| **Discard rate** | Count of entries with `status = 'discard'` divided by total entries in the window. Range: 0.0–1.0. |
| **Adversarial catch rate** | Count of entries with `status = 'adversarial-fail'` divided by (count of `pass` + count of `adversarial-fail`). Requires Phase 2 (adversarial generation). Omitted when no `adversarial-fail` entries exist. |
| **First-try pass rate** | Count of "first-try" iterations that passed, divided by total "first-try" iterations in the window. A "first-try" iteration is one where the immediately preceding entry in results.tsv has `status = 'pass'`, or the entry is the first in the window. **Heuristic limitation:** does not track task identity. If plan A passes and plan B starts, the first iteration of plan B is treated as first-try. Accuracy improves over larger windows. |
| **Score volatility** | Standard deviation of non-null score values in the window. Low volatility (scores barely change) can indicate stagnation. High volatility (scores swing wildly) can indicate instability. |
| **Stall frequency** | Count of entries with `status = 'stall'` divided by total entries in the window. **Prerequisite:** the run loop must write `stall` status entries to results.tsv. As of v0.5, stalls exit the loop without recording. Until the run loop is updated, this metric reports "unavailable." |
| **Partial window** | When fewer than `window` entries exist but at least 5 do. Calibration computes with available data and labels the report "(partial window: N/W)". |
| **Minimum data threshold** | 5 entries. Below this, calibration reports "insufficient data (N entries, need 5)." |

---

## Architecture

### Data Flow

```
results.tsv → readResults(window) → computeCalibration() → CalibrationReport
                                                                    ↓
                                    detectTrustDrift(report, thresholds) → TrustDriftResult
                                                                    ↓
                                              formatCalibrationReport() → string (for CLI)
                                              formatCalibrationJSON()   → object (for --json)
```

### New Files

| File | Responsibility |
|------|----------------|
| `src/commands/score/calibration.ts` | Core module: `computeCalibration()`, `detectTrustDrift()`, `formatCalibrationReport()`, `formatCalibrationJSON()` |
| `src/commands/score/calibration.test.ts` | Unit tests for all exports |

### Changed Files

| File | Change | Risk |
|------|--------|------|
| `src/commands/score/index.ts` | Add `calibration` to `ScoreOptions` interface. Add calibration branch in `scoreCommand()`. | Low — new branch, no existing paths modified |
| `src/cli.ts` | Add `--calibration` and `--calibration --json` flag to `ralph score` command registration. | Low — additive option |
| `src/commands/run/progress.ts` | Call `computeCalibration()` + `formatCalibrationReport()` in `printFinalSummary()` when data is sufficient. | Low — appends output after existing summary |
| `src/config/schema.ts` | Add `CalibrationConfig` interface and `calibration?: CalibrationConfig` to `RalphConfig` and `RawRalphConfig`. | Low — optional field, no existing validation breaks |
| `src/config/defaults.ts` | Add `DEFAULT_CALIBRATION` constant. | Low — new export |
| `src/config/loader.ts` | Merge calibration defaults in config assembly. | Low — follows existing pattern for other config sections |
| `src/config/validate.ts` | Add calibration field validation (numeric ranges). | Low — additive |

### Function Signatures

```typescript
// calibration.ts

export interface CalibrationReport {
  window: number;                       // configured window size
  actual: number;                       // actual entries analyzed (may be < window)
  passRate: number;                     // 0.0–1.0
  discardRate: number;                  // 0.0–1.0
  adversarialCatchRate: number | null;  // null if no adversarial-fail entries
  firstTryPassRate: number;             // 0.0–1.0 (heuristic)
  scoreVolatility: number | null;       // null if < 2 scored entries
  stallFrequency: number | null;        // null if no stall entries in results.tsv
  scores: (number | null)[];            // raw scores for sparkline
}

export interface TrustDriftSignal {
  name: string;          // e.g., "High pass rate"
  value: string;         // e.g., "97%"
  threshold: string;     // e.g., "> 95%"
  interpretation: string;
}

export interface TrustDriftResult {
  isDrift: boolean;
  signals: TrustDriftSignal[];
}

export interface CalibrationThresholds {
  window: number;
  warnPassRate: number;
  warnDiscardRate: number;
  warnVolatility: number;
}

/** Compute calibration metrics from the last `window` entries in results.tsv. */
export function computeCalibration(
  entries: ResultEntry[],
  window: number,
): CalibrationReport;

/** Detect trust drift from calibration metrics. Requires 2+ signals to fire. */
export function detectTrustDrift(
  report: CalibrationReport,
  thresholds: CalibrationThresholds,
): TrustDriftResult;

/** Format calibration report for terminal output. */
export function formatCalibrationReport(
  report: CalibrationReport,
  drift: TrustDriftResult,
): string;

/** Format calibration report as structured JSON. */
export function formatCalibrationJSON(
  report: CalibrationReport,
  drift: TrustDriftResult,
): object;
```

### Config Type

```typescript
// Added to schema.ts

export interface CalibrationConfig {
  window: number;              // default: 30
  'warn-pass-rate': number;    // default: 0.95
  'warn-discard-rate': number; // default: 0.01
  'warn-volatility': number;   // default: 0.005
}

// Added to RalphConfig
calibration?: CalibrationConfig | undefined;
```

```yaml
# .ralph/config.yml
calibration:
  window: 30
  warn-pass-rate: 0.95
  warn-discard-rate: 0.01
  warn-volatility: 0.005
```

### Layer Rules

- `calibration.ts` is in the `score` domain. It imports from:
  - `./results.js` — `readResults()`
  - `./types.js` — `ResultEntry`
  - `./trend.js` — `renderSparkline()` (for report formatting)
  - `../../config/schema.js` — `CalibrationConfig`
- `calibration.ts` does NOT import from `run/`, `lint/`, `gc/`, or any other command domain.
- `run/progress.ts` imports `computeCalibration`, `detectTrustDrift`, `formatCalibrationReport` from `../score/calibration.js` — same cross-domain pattern as existing `run → score` imports.

### Prerequisites

These are NOT part of this spec but affect metric availability:

| Prerequisite | Required for | Status | Owner |
|--------------|-------------|--------|-------|
| `adversarial-fail` status in ResultEntry | Adversarial catch rate metric | Not started | Phase 2 spec (adversarial-generation.md) |
| Stall events written to results.tsv | Stall frequency metric | Not started | Run loop enhancement (separate ticket) |

Calibration must function correctly when these prerequisites are absent. See Graceful Degradation principle.

---

## Features

### F-CT01: Calibration Metrics Computation

**Goal:** Compute six calibration metrics from `results.tsv` data over a rolling window.

**Type:** One-time implementation, ongoing computation.

**Procedure:**
1. Call `readResults(window)` to get the last N entries.
2. If entries.length < 5, return an "insufficient data" indicator.
3. Compute each metric from the entries array:
   - **Pass rate:** `entries.filter(e => e.status === 'pass').length / entries.length`
   - **Discard rate:** `entries.filter(e => e.status === 'discard').length / entries.length`
   - **Adversarial catch rate:** If any entry has `status === 'adversarial-fail'`, compute `adversarialFails / (passes + adversarialFails)`. If none, set to `null`.
   - **First-try pass rate:** Walk entries in order. Entry[0] is "first-try." For entry[i] where i > 0: it's "first-try" if entry[i-1].status === 'pass'. Count first-try entries that have status 'pass', divide by total first-try entries.
   - **Score volatility:** Collect all non-null scores. If < 2, set to `null`. Otherwise compute standard deviation.
   - **Stall frequency:** If any entry has `status === 'stall'`, compute `stalls / entries.length`. If none, set to `null`.
4. Return `CalibrationReport`.

**Edge Cases:**
- All entries have the same status (100% pass rate or 100% fail rate) — valid, compute normally.
- All scores are identical — volatility = 0, which fires the low-volatility signal.
- Only 1 scored entry — volatility = `null`.
- Window larger than available data — use all available entries (partial window).
- Empty results.tsv — return "insufficient data."
- Entries with `score: null` — excluded from volatility computation but counted in rate computations.

**Delegation Safety:**
- ⚠️ MUST use `readResults()` from `./results.js`. Do NOT create a second TSV parser.
- ⚠️ Do NOT modify `ResultEntry` type or `results.tsv` format.
- ⚠️ Standard deviation formula: use population stddev (`Math.sqrt(sum((x - mean)^2) / n)`), not sample stddev.

**Success Criteria:**
- ✅ Immediate: `computeCalibration()` returns correct metrics for a known dataset (10+ unit tests).
- ⚙️ Mechanical: Function accepts `ResultEntry[]` and `number`, returns `CalibrationReport`. No side effects.
- 📏 Trailing: Metrics correlate with actual project health over 100+ iteration runs (manual spot-check after deployment).

---

### F-CT02: Trust Drift Detection

**Goal:** Detect when multiple calibration signals simultaneously indicate validation may be too lenient.

**Type:** One-time implementation, ongoing detection.

**Procedure:**
1. Accept a `CalibrationReport` and `CalibrationThresholds`.
2. Check each signal against its threshold:
   - Pass rate > `warnPassRate` → signal fires
   - Discard rate < `warnDiscardRate` → signal fires (inverted — LOW discard rate is suspicious)
   - Score volatility < `warnVolatility` AND volatility is not `null` → signal fires
   - Adversarial catch rate = 0% AND adversarial data exists → signal fires
3. If 2 or more signals fire, `isDrift = true`.
4. Return all fired signals with their values, thresholds, and interpretations.

**Edge Cases:**
- Exactly 1 signal fires — NOT drift. Single-signal anomalies are common and benign.
- All 4 signals fire — drift with maximum confidence.
- Adversarial data absent — that signal is excluded from consideration entirely (not counted as "did not fire").
- Volatility is `null` (< 2 scored entries) — that signal is excluded.
- Stall frequency is included in the report but NOT a drift signal (stalls are an operational issue, not a validation calibration issue).

**Delegation Safety:**
- ⚠️ Threshold comparison directions: pass rate and adversarial catch rate use `>`, discard rate and volatility use `<`. Getting these inverted produces false positives/negatives.
- ⚠️ `null` metrics are excluded, not treated as 0.

**Success Criteria:**
- ✅ Immediate: 2-signal combination returns `isDrift: true`. 1-signal returns `isDrift: false`. (Combinatorial test matrix: all pairs of 4 signals = 6 tests minimum.)
- ⚙️ Mechanical: Pure function, no side effects, no config reads inside the function.

---

### F-CT03: CLI Flag `--calibration`

**Goal:** `ralph score --calibration` prints the calibration report with all metrics, sparkline, and trust status.

**Type:** One-time implementation.

**Procedure:**
1. Add `calibration?: boolean` to `ScoreOptions` interface in `index.ts`.
2. In `scoreCommand()`, when `options.calibration` is true:
   a. Load config to get calibration thresholds (fall back to defaults).
   b. Call `readResults(thresholds.window)`.
   c. If entries < 5, print "Insufficient data" message and return.
   d. Call `computeCalibration()`.
   e. Call `detectTrustDrift()`.
   f. Print formatted report via `formatCalibrationReport()`.
3. Add `--calibration` option to the `ralph score` command in `cli.ts`.

**Output Format (normal):**
```
Calibration Report (last 30 iterations)
─────────────────────────────────────────
Pass rate:           28/30  93.3%
Discard rate:         2/30   6.7%
First-try pass rate: 25/28  89.3%
Score volatility:    0.018
Stall frequency:     unavailable (no stall entries recorded)

Score trend: ▂▃▃▄▅▅▅▆▆▆▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇▇█▇█

Trust status: ✓ Normal
  All calibration metrics within expected ranges.
```

**Output Format (drift detected):**
```
Trust status: ⚠ Drift (2 signals)
  High pass rate: 97% (threshold: > 95%)
  Low score volatility: 0.002 (threshold: < 0.005)

  Suggested actions:
  - Run `ralph gc --json` and compare drift item counts to previous run
  - Review the last 5 commits manually for subtle issues
  - Consider lowering warn-pass-rate if 97% is expected for this project
```

**Output Format (partial window):**
```
Calibration Report (12 of 30 iterations — partial window)
```

**Output Format (insufficient data):**
```
Calibration: insufficient data (3 entries, need 5)
```

**Edge Cases:**
- `--calibration` combined with `--history` or `--trend` — calibration takes precedence (print calibration only, not both).
- `--calibration` combined with `--json` — handled by F-CT04.
- No config file — use defaults from `DEFAULT_CALIBRATION`.

**Delegation Safety:**
- ⚠️ Register the flag in BOTH `cli.ts` (commander option) and `index.ts` (ScoreOptions interface). Missing either causes a silent no-op or a type error.

**Success Criteria:**
- ✅ Immediate: CLI test confirms `--calibration` produces formatted output matching the template above.
- ⚙️ Mechanical: `ralph score --calibration` exits 0 (never fails — informational only).

---

### F-CT04: JSON Output

**Goal:** `ralph score --calibration --json` outputs structured JSON for CI pipeline consumption.

**Type:** One-time implementation.

**Procedure:**
1. In `scoreCommand()`, when `options.calibration && options.json`:
   a. Compute calibration report and drift as in F-CT03.
   b. Call `formatCalibrationJSON()`.
   c. Print via `console.log(JSON.stringify(result, null, 2))`.

**JSON Schema:**
```json
{
  "calibration": {
    "window": 30,
    "actual": 30,
    "passRate": 0.933,
    "discardRate": 0.067,
    "adversarialCatchRate": null,
    "firstTryPassRate": 0.893,
    "scoreVolatility": 0.018,
    "stallFrequency": null,
    "partial": false
  },
  "trustDrift": {
    "isDrift": false,
    "signals": []
  },
  "timestamp": "2026-03-13T06:51:00.000Z"
}
```

When drift is detected:
```json
{
  "trustDrift": {
    "isDrift": true,
    "signals": [
      {
        "name": "High pass rate",
        "value": "0.97",
        "threshold": "> 0.95",
        "interpretation": "Validation may not be catching subtle issues"
      }
    ]
  }
}
```

**Edge Cases:**
- `null` metric values serialize as JSON `null` (not omitted, not empty string).
- Insufficient data returns: `{ "calibration": null, "error": "insufficient data", "entries": 3, "minimum": 5 }`.

**Delegation Safety:**
- ⚠️ Use `console.log` for JSON output (same pattern as existing `--json` in `scoreCommand`). Do not use `output.plain()` which adds formatting.

**Success Criteria:**
- ✅ Immediate: Output is valid JSON that parses without error. All fields present and correctly typed.
- ⚙️ Mechanical: `JSON.parse(stdout)` succeeds in a test.

---

### F-CT05: Run Loop Integration

**Goal:** At the end of `ralph run`, when enough data exists, print calibration summary.

**Type:** One-time implementation, ongoing display.

**Procedure:**
1. In `printFinalSummary()` in `progress.ts`:
   a. After existing summary output, attempt calibration:
   b. Import and call `readResults()` with configured (or default) window.
   c. If entries.length >= 5, compute calibration and drift.
   d. Print a compact version of the calibration report (2-4 lines, not the full report).
   e. If drift detected, print the warning.
   f. If entries < 5, print nothing (don't clutter with "insufficient data" at the end of every short run).

**Compact Format:**
```
Calibration (last 30): pass=93% discard=7% volatility=0.018 ✓ Normal
```

Or with drift:
```
Calibration (last 30): pass=97% discard=0% volatility=0.002
  ⚠ Trust drift: high pass rate + low volatility. Run ralph score --calibration for details.
```

**Edge Cases:**
- `printFinalSummary` is called with a `Checkpoint` but needs config for thresholds. Must load config OR accept thresholds as a parameter. **Decision:** pass thresholds as an optional parameter to avoid loading config inside a print function. The caller (`runCommand` in `index.ts`) loads config and passes thresholds.
- Short runs (< 5 iterations total in results.tsv) — print nothing.
- Config not loaded (e.g., config file missing) — use defaults.

**Delegation Safety:**
- ⚠️ Do NOT load config inside `printFinalSummary()`. Accept thresholds as a parameter. The function currently takes `(reason, checkpoint)` — add an optional third parameter.
- ⚠️ Calibration in the run loop is informational only. It MUST NOT affect the stop reason, exit code, or any loop behavior.

**Success Criteria:**
- ✅ Immediate: Run loop test confirms calibration line appears after summary when ≥5 entries exist.
- ✅ Immediate: Run loop test confirms no calibration line when < 5 entries exist.
- 👁️ Process: Calibration output is visually distinguishable from the main summary (indented or prefixed).

---

### F-CT06: Configurable Thresholds

**Goal:** Calibration thresholds are configurable via `calibration:` config section.

**Type:** One-time implementation.

**Procedure:**
1. Add `CalibrationConfig` interface to `schema.ts`.
2. Add `DEFAULT_CALIBRATION` to `defaults.ts`:
   ```typescript
   export const DEFAULT_CALIBRATION: CalibrationConfig = {
     window: 30,
     'warn-pass-rate': 0.95,
     'warn-discard-rate': 0.01,
     'warn-volatility': 0.005,
   };
   ```
3. Add `calibration?: CalibrationConfig` to `RalphConfig`.
4. Add partial calibration to `RawRalphConfig`.
5. Merge defaults in `loader.ts` (follow existing pattern: `{ ...DEFAULT_CALIBRATION, ...raw.calibration }`).
6. Add validation in `validate.ts`:
   - `window` must be integer ≥ 5
   - `warn-pass-rate` must be number in (0, 1]
   - `warn-discard-rate` must be number in [0, 1)
   - `warn-volatility` must be number ≥ 0

**Edge Cases:**
- No `calibration:` section in config — use all defaults.
- Partial config (e.g., only `window: 50`) — merge with defaults for missing fields.
- Invalid values (e.g., `window: -1`) — config validation rejects with descriptive error.

**Delegation Safety:**
- ⚠️ Follow the exact pattern used by existing config sections (e.g., `scoring`, `heal`). Do not invent a new config loading pattern.
- ⚠️ Add the field to BOTH `RalphConfig` (resolved) and `RawRalphConfig` (raw from YAML). Missing from either causes type errors.

**Success Criteria:**
- ✅ Immediate: Config with custom thresholds loads correctly. Config with missing thresholds uses defaults.
- ✅ Immediate: Invalid config values produce validation error (not silent fallback).
- ⚙️ Mechanical: `ralph config validate` passes with and without `calibration:` section.

---

### F-CT07: Adversarial-Aware Metrics (Conditional)

**Goal:** When adversarial-fail entries exist in results.tsv, include adversarial catch rate in the calibration report.

**Type:** One-time implementation. **No-op until Phase 2 delivers `adversarial-fail` status type.**

**Procedure:**
1. In `computeCalibration()`, check for entries with `status === 'adversarial-fail'`.
2. If present: compute `adversarialFails / (passes + adversarialFails)`. Guard against division by zero (if both are 0, set to `null`).
3. If absent: set `adversarialCatchRate` to `null`.
4. In `detectTrustDrift()`, only evaluate the adversarial signal when `adversarialCatchRate !== null`.
5. In report formatting, omit the adversarial line entirely when `null`.

**Current state:** `ResultEntry.status` type is `'pass' | 'fail' | 'timeout' | 'discard'`. The `adversarial-fail` value does not exist in the union type. This means:
- TypeScript will flag `status === 'adversarial-fail'` as always-false with strict type checking.
- **Implementation must use a string comparison that bypasses the type narrowing:** `(entry.status as string) === 'adversarial-fail'` — ugly but necessary until Phase 2 updates the type union.
- Alternatively, cast entries to a wider type: `entry.status === ('adversarial-fail' as ResultEntry['status'])`.

**Edge Cases:**
- Mixed entries: some adversarial-fail, some not — compute rate over the subset.
- All entries are adversarial-fail — rate = 100%, pass rate may be 0%.
- Adversarial catch rate = 0% with adversarial data present — signal fires (adversary isn't finding anything).

**Delegation Safety:**
- ⚠️ Do NOT modify `ResultEntry` status type union. That's Phase 2's responsibility.
- ⚠️ The type assertion is intentional and should have a comment explaining why.

**Success Criteria:**
- ✅ Immediate: With mock entries containing `adversarial-fail` status, catch rate is computed correctly.
- ✅ Immediate: Without adversarial entries, metric is `null` and omitted from report.
- ⚙️ Mechanical: No type errors in strict mode (via assertion).

---

## Implementation Sequence

| Step | Feature | Depends On | Files | Estimated Effort |
|------|---------|------------|-------|-----------------|
| 1 | F-CT06: Config schema | — | `schema.ts`, `defaults.ts`, `loader.ts`, `validate.ts` | 1 iteration |
| 2 | F-CT01: Core computation | Step 1 | `calibration.ts` | 1-2 iterations |
| 3 | F-CT02: Trust drift detection | Step 2 | `calibration.ts` (extends) | 1 iteration |
| 4 | F-CT07: Adversarial-aware metrics | Step 2 | `calibration.ts` (extends) | < 1 iteration |
| 5 | F-CT04: JSON output | Steps 2-3 | `calibration.ts` (extends) | < 1 iteration |
| 6 | F-CT03: CLI flag | Steps 1-5 | `index.ts`, `cli.ts` | 1 iteration |
| 7 | F-CT05: Run loop integration | Steps 1-3 | `progress.ts`, `run/index.ts` | 1 iteration |

**Total estimated effort:** 5-7 iterations.

**Why this order:**
- Config schema first: everything else reads thresholds from config.
- Core computation before drift detection: drift depends on metrics.
- Adversarial metrics alongside core: same function, minor extension.
- JSON output before CLI: formatters are needed by both CLI and JSON paths.
- CLI flag before run loop: standalone use validates the feature before integrating it into the loop.
- Run loop last: depends on everything else being correct. Run loop integration is the highest-risk step because it touches the critical path.

---

## Feature Tracker

| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| F-CT01 | Calibration Metrics Computation | ❌ Not started | |
| F-CT02 | Trust Drift Detection | ❌ Not started | |
| F-CT03 | CLI Flag --calibration | ❌ Not started | |
| F-CT04 | JSON Output | ❌ Not started | |
| F-CT05 | Run Loop Integration | ❌ Not started | |
| F-CT06 | Configurable Thresholds | ❌ Not started | |
| F-CT07 | Adversarial-Aware Metrics | ❌ Not started | No-op until Phase 2 |

---

## Acceptance Criteria

### AC-1: Calibration computation from results.tsv
Given a `results.tsv` with ≥5 entries, `computeCalibration()` returns pass rate, discard rate, first-try pass rate, and score volatility. Adversarial catch rate and stall frequency are included only when corresponding status entries exist.

### AC-2: Trust drift detection (multi-signal)
Given calibration metrics where pass rate > 0.95 AND discard rate < 0.01, `detectTrustDrift()` returns `isDrift: true` with both signals named.

### AC-3: Single signal is not drift
Given calibration metrics where only pass rate > 0.95 (all other metrics within normal ranges), `detectTrustDrift()` returns `isDrift: false`.

### AC-4: CLI output
`ralph score --calibration` prints the calibration report with all available metrics, sparkline, and trust status line.

### AC-5: Insufficient data
Given fewer than 5 entries in results.tsv, `ralph score --calibration` prints "insufficient data (N entries, need 5)" rather than computing metrics.

### AC-6: Partial window
Given 12 entries with window=30, `ralph score --calibration` computes metrics from 12 entries and labels the report "(partial window: 12/30)".

### AC-7: Run loop integration
At the end of `ralph run`, when ≥5 entries exist in results.tsv, a compact calibration summary is printed. When < 5 entries, nothing is printed.

### AC-8: Configurable thresholds
Calibration thresholds are configurable via `calibration:` config. Defaults are used when config is absent. Invalid values are rejected by `ralph config validate`.

### AC-9: Adversarial-aware (conditional)
When `adversarial-fail` entries exist in results.tsv, adversarial catch rate is computed and included. When none exist, the metric is omitted (not zero).

### AC-10: JSON output
`ralph score --calibration --json` outputs valid JSON matching the schema defined in F-CT04. All fields present, null values serialized as JSON null.

### SC-R1: Regression — existing commands unaffected
`ralph score`, `ralph score --history`, `ralph score --trend`, `ralph score --compare`, and `ralph score --json` (without `--calibration`) produce identical output before and after this change. All 832 existing tests pass.

---

## Compatibility Notes

**For consumers of `ralph score`:**
- No existing flags or output formats change.
- The `--calibration` flag is new and opt-in.
- JSON output from `ralph score --json` (without `--calibration`) is unchanged.

**For consumers of `results.tsv`:**
- No changes to the TSV format or column set.
- Calibration reads from results.tsv but never writes to it.

**For config files:**
- The new `calibration:` config section is optional. Existing configs without it work unchanged.
- No deprecations.

**For the run loop:**
- `printFinalSummary` gains an optional parameter. Existing callers that don't pass it get no calibration output (backward compatible).

---

## Non-Goals

- **Automatic threshold adjustment.** Calibration reports trust drift; it doesn't automatically tighten validation. That's a human decision.
- **Per-domain calibration.** Calibration is project-level, not per-domain. Domain-level analysis is future scope.
- **Historical calibration trends.** v0.7 computes calibration from current results.tsv. Tracking calibration over time (has trust drift gotten worse?) is future scope.
- **Agent confidence parsing.** Calibration uses outcome data, not agent self-assessment. If agents eventually emit confidence scores, that's a future input.
- **Modifying results.tsv schema.** Calibration does not add columns or status types. Upstream specs (adversarial generation, staged validation) own those changes.
- **Recording stall events in results.tsv.** That's a run loop change outside this spec's scope. Calibration handles stall data if present but doesn't create it.
- **Enriching agent prompts with calibration data.** Future enhancement, not v0.7.

---

## Test Plan

### Unit Tests — `calibration.test.ts`

**computeCalibration():**
- Window of 30 entries, mixed statuses → correct rates
- All passes (100% pass rate, 0% discard rate) → computed correctly
- All failures (0% pass rate) → computed correctly
- Single entry → below minimum threshold (insufficient data)
- 5 entries exactly → computes (minimum threshold)
- 4 entries → insufficient data
- All scores identical → volatility = 0
- Two scored entries → volatility computed (minimum for stddev)
- All scores null → volatility = null
- One score non-null → volatility = null (need ≥ 2)
- First-try heuristic: pass, pass, fail, pass, pass → first-try at indices 0, 1, 3 (index 2 follows a pass so it's first-try, but it failed; index 3 follows a fail so it's a retry, index 4 follows a pass so it's first-try)

Wait — let me re-derive the first-try heuristic for the test:
- Entry 0: first in window → first-try, status=pass → counts as first-try pass
- Entry 1: prev=pass → first-try, status=pass → counts as first-try pass
- Entry 2: prev=pass → first-try, status=fail → counts as first-try NON-pass
- Entry 3: prev=fail → retry (not first-try)
- Entry 4: prev=pass → first-try, status=pass → counts as first-try pass

First-try entries: 0, 1, 2, 4 (4 total). First-try passes: 0, 1, 4 (3 total). First-try pass rate: 3/4 = 75%.

**detectTrustDrift():**
- 0 signals fire → isDrift: false
- 1 signal fires (high pass rate only) → isDrift: false
- 2 signals fire (high pass rate + low discard) → isDrift: true, 2 signals
- 3 signals fire → isDrift: true, 3 signals
- 4 signals fire → isDrift: true, 4 signals
- All 6 pairwise combinations of 2 signals → each returns isDrift: true
- Null adversarial rate → adversarial signal excluded, not counted as "not fired"
- Null volatility → volatility signal excluded

**formatCalibrationReport():**
- Normal state → includes "✓ Normal"
- Drift state → includes "⚠ Drift" with signal details
- Partial window → includes "(partial window: N/W)"
- Adversarial data present → includes adversarial catch rate line
- Adversarial data absent → no adversarial line
- Stall data absent → "unavailable" label

**formatCalibrationJSON():**
- Output parses as valid JSON
- All numeric fields are numbers (not strings)
- Null fields are JSON null
- Insufficient data returns error object

### CLI Tests — extend `cli.test.ts`

- `--calibration` flag produces formatted output
- `--calibration --json` produces valid JSON
- `--calibration` with insufficient data prints message and exits 0
- `--calibration` combined with `--history` → calibration takes precedence

### Integration Tests — extend `progress.test.ts`

- `printFinalSummary` with calibration thresholds and ≥5 entries → compact line printed
- `printFinalSummary` with < 5 entries → no calibration output
- `printFinalSummary` without thresholds parameter → no calibration output (backward compatible)

### Config Tests — extend `loader.test.ts` and `validate.test.ts`

- Config with `calibration:` section loads correctly
- Config without `calibration:` uses defaults
- Partial calibration config merges with defaults
- Invalid window (< 5) → validation error
- Invalid warn-pass-rate (> 1 or ≤ 0) → validation error
