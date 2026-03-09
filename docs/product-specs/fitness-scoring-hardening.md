# Fitness Scoring — Pre-Build Hardening Analysis

*Written 2026-03-09. Covers the three ungapped failure domains plus 12 "build it" items from failure mapping.*

---

## Failure Simulations

### Simulation 1: Score Gaming via Trivial Tests

**Setup:** Project with 20 meaningful tests, 100% pass rate, 75% coverage.
**Attack:** Agent adds 30 `expect(true).toBe(true)` tests in one iteration.

```
Before:  passed=20, failed=0, rate=1.0, coverage=0.75
         score = 1.0 * 0.6 + 0.75 * 0.4 = 0.90

After:   passed=50, failed=0, rate=1.0, coverage=0.75
         score = 1.0 * 0.6 + 0.75 * 0.4 = 0.90 (unchanged)
```

**Result:** Score doesn't change because pass *rate* is already 1.0. The gaming is invisible to the scorer. Test count increased 150% but the scorer doesn't track absolute counts.

**Variant — gaming with coverage:** Agent adds dead branches that get auto-covered:
```
Before:  rate=1.0, coverage=0.75, score=0.90
After:   rate=1.0, coverage=0.82, score=0.928, delta=+0.028
```
Score improves, but the coverage gain is artificial.

**Hardening:** Test count tracking as a metric (not a score component) — logged in results.tsv so the oracle and `ralph score --history` can see count jumps. A >100% increase in one iteration is flagged as suspicious in the score context. This doesn't auto-revert (legitimate test additions look similar), but it surfaces the signal for human/oracle review.

---

### Simulation 2: Baseline Poisoning

**Setup:** Project with 1 flaky test out of 50.

```
Iteration 1: Flaky test passes. 50/50. Coverage 80%.
             score = 1.0 * 0.6 + 0.80 * 0.4 = 0.92 (baseline)

Iteration 2: Flaky test fails. 49/50. Coverage 80%.
             score = 0.98 * 0.6 + 0.80 * 0.4 = 0.908
             delta = -0.012 (within 0.02 threshold, PASS)

Iteration 3: Flaky test fails. 49/50. Coverage 79% (agent removed some dead code).
             score = 0.98 * 0.6 + 0.79 * 0.4 = 0.904
             delta vs last pass (0.908) = -0.004 (PASS)
```

This case actually works fine — the threshold absorbs single-test flakiness.

**Worse case: 5 flaky tests in a 30-test suite:**
```
Iteration 1: All pass. 30/30. Score = 1.0 * 0.6 + 0.80 * 0.4 = 0.92 (baseline)
Iteration 2: 3 flaky fail. 27/30. Score = 0.9 * 0.6 + 0.80 * 0.4 = 0.86
             delta = -0.06 (REVERT — exceeds 0.02)

Iteration 3: 2 flaky fail. 28/30. Score = 0.933 * 0.6 + 0.80 * 0.4 = 0.88
             delta vs baseline 0.92 = -0.04 (REVERT)

Iteration 4: 4 flaky fail. 26/30. Score = 0.867 * 0.6 + 0.80 * 0.4 = 0.84
             delta vs baseline 0.92 = -0.08 (REVERT)
```

**Result:** Three consecutive discards. Loop is stuck — every iteration compared against the inflated baseline.

**Hardening:**
1. **Baseline recalibration:** After 3 consecutive discards, recalibrate baseline to the *highest* discarded score. In the example, after 3 discards (0.86, 0.88, 0.84), baseline resets to 0.88. Next iteration compared against 0.88 instead of 0.92.
2. **`--baseline-score` flag:** Human sets expected score explicitly, bypassing first-iteration measurement.

---

### Simulation 3: Slow Bleed (Cumulative Regression)

**Setup:** 0.02 threshold. Each iteration drops score by 0.015 (within threshold).

```
Iter 1: 0.90 (baseline)
Iter 2: 0.885 (delta -0.015, PASS — within 0.02)
Iter 3: 0.870 (vs 0.885, delta -0.015, PASS)
Iter 4: 0.855 (vs 0.870, delta -0.015, PASS)
...
Iter 10: 0.765 (total drop: -0.135 from baseline)
```

**Result:** Each step passes individually. Cumulative drift: -0.135 (15% quality loss). No revert ever fires.

**Hardening:** Cumulative regression check against the run's *best* score. New config: `scoring.cumulative-threshold` (default 0.10). If `best_score - current_score > cumulative_threshold`, revert regardless of per-step delta.

---

### Simulation 4: Concurrent Run Corruption

**Setup:** Two terminals, same repo.

```
T=0s:   Terminal 1: ralph run. Baseline = abc123.
T=1s:   Terminal 2: ralph run. Baseline = abc123.
T=60s:  T1 agent commits def456. T1 scores, passes. results.tsv row 1.
T=65s:  T2 agent commits ghi789 (branched from abc123). T2 scores...
        T2's HEAD is ghi789 but T1 already committed def456.
        results.tsv now has rows from both runs interleaved.
T=120s: T1 iteration 2 starts. T2 discards (regression). T2 reverts to abc123.
        THIS UNDOES T1'S COMMIT (def456). T1 iteration 2 is now building on a ghost baseline.
```

**Result:** Data loss. T1's successful work is erased by T2's revert. Both runs' results.tsv entries are interleaved and meaningless.

**Hardening:** PID lockfile at `.ralph/run.lock`. Exclusive create (O_EXCL / `wx` flag). Contains PID + ISO timestamp. Stale lock detection via `process.kill(pid, 0)`. Released on exit (normal, SIGINT, SIGTERM).

---

### Simulation 5: Timeout Mid-Git Operation

**Setup:** 900s iteration timeout. Agent runs `git commit` at second 899.

```
T=899s: Agent calls git commit -am "implement feature"
        git starts writing objects, updating index
T=900s: SIGTERM → agent process receives signal
        git may or may not handle SIGTERM gracefully mid-write
T=910s: SIGKILL → agent process force-killed
        git state: .git/index.lock exists, objects may be partially written
T=910s: Revert: git reset --hard abc123
        ERROR: "Unable to create lock file '.git/index.lock': File exists"
        Revert FAILS. Loop crashes.
```

**Hardening:** Before `git reset --hard`, unconditionally `rm -f .git/index.lock`. Also run `git clean -f .git/*.lock` for any other stale locks.

---

### Simulation 6: Keep File Discovery

**Setup:** Agent exploring the `.ralph/` directory.

```
Agent: ls .ralph/
→ config.yml  checkpoint.yml  results.tsv

Agent: cat .ralph/checkpoint.yml
→ sees lastScore, iteration history

Agent: # Agent reads about .ralph/keep somewhere (man page, error message, etc.)
Agent: echo "preserving my changes" > .ralph/keep
→ Score regresses, but .ralph/keep exists → revert suppressed
```

**Hardening:** Only honor `.ralph/keep` if it existed *before* agent spawn. Capture `existsSync('.ralph/keep')` before spawning. If keep file is new (didn't exist before, exists after), treat as agent-created and ignore it for revert purposes.

---

### Simulation 7: Score Script Side Effects

**Setup:** Custom `score.sh` that installs a tool to measure bundle size.

```bash
#!/bin/bash
npm install --save-dev bundle-analyzer  # SIDE EFFECT
npx bundle-analyzer --json > /tmp/bundle.json
size=$(jq .totalKb /tmp/bundle.json)
echo "0.85\tbundle_kb=$size"
```

**Result:** `node_modules/` modified. `package.json` modified. `package-lock.json` modified. Next iteration's agent sees these changes as part of the baseline. If auto-commit runs after scoring, the score script's side effects get committed.

**Hardening:** Post-scoring dirty check. After score script exits, run `git status --porcelain`. If new dirty files appeared that weren't dirty before scoring, warn in output and clean them with `git checkout -- .` + remove new untracked files. Don't fail — just restore.

---

## Hardening Decisions

### H1: Run Lock (new feature F-FS11)
PID lockfile at `.ralph/run.lock`. Atomic creation via `writeFileSync` with `wx` flag. Stale detection via `process.kill(pid, 0)`. Auto-cleanup on exit.

### H2: Test Count Tracking (amend F-FS02)
Default scorer extracts and logs test count as a metric. `{score_context}` includes count when available. Count jump >100% flagged as suspicious.

### H3: Baseline Recalibration (amend F-FS04)
After 3 consecutive discards, baseline resets to best discarded score. Logged as `[baseline recalibrated from X to Y]` in results.tsv.

### H4: Cumulative Regression Check (amend F-FS04)
New config: `scoring.cumulative-threshold` (default 0.10). Compare against run's best score. If `best - current > cumulative-threshold`, revert with status `discard` and note `[cumulative regression]`.

### H5: Git Lock Cleanup (amend F-FS04)
Before `git reset --hard`, always `rm -f .git/index.lock .git/refs/heads/*.lock`.

### H6: Keep File Timing (amend F-FS04)
Snapshot `.ralph/keep` existence before agent spawn. Only honor keep if it pre-existed. Agent-created keep files are ignored and deleted.

### H7: Post-Scoring Dirty Check (amend scoring flow)
After score script exits, `git status --porcelain`. If state changed, restore with `git checkout -- .` + remove new untracked files. Warn in output.

### H8: Timeout Scope Clarification (amend F-FS05)
Explicitly document: iteration timeout covers agent phase only. Validation and scoring have independent timeouts. Total worst-case: iteration-timeout + 240s (validation) + 60s (scoring).

### H9: `--no-score` Still Logs (amend F-FS10)
Results.tsv entries written for `fail` and `timeout` statuses even under `--no-score`. Score/delta/metrics columns are `—`.

### H10: Metrics Validation (amend F-FS03)
On TSV write, validate metrics string: replace tabs with spaces, truncate to 200 chars, reject/sanitize control characters.

### H11: `--baseline-score` Flag (amend F-FS08 / run flags)
`ralph run --baseline-score 0.85` — overrides first-iteration baseline. First iteration still scored but compared against this value instead of establishing its own baseline.

### H12: Template Contract Header (amend F-FS07)
Add placeholder contract header to BUILD_TEMPLATE per F025 pattern.

---

## New Acceptance Criteria

- AC-54: `.ralph/run.lock` prevents concurrent `ralph run` instances
- AC-55: Stale lockfile (dead PID) is detected and overwritten
- AC-56: Lock released on normal exit, SIGINT, and SIGTERM
- AC-57: Default scorer includes `test_count` and `test_total` in metrics output
- AC-58: `{score_context}` flags test count jumps >100% as suspicious
- AC-59: After 3 consecutive discards, baseline recalibrates to best discarded score
- AC-60: Recalibration logged in results.tsv description
- AC-61: Cumulative regression check fires when best_score - current > cumulative-threshold
- AC-62: `.git/index.lock` removed before every `git reset --hard`
- AC-63: `.ralph/keep` only honored if it existed before agent spawn
- AC-64: Agent-created `.ralph/keep` ignored and deleted with warning
- AC-65: Post-scoring `git status` detects and restores score script side effects
- AC-66: `--no-score` still writes results.tsv entries for `fail` and `timeout`
- AC-67: Metrics string sanitized: tabs replaced, length capped, control chars removed
- AC-68: `--baseline-score <float>` overrides first-iteration baseline
- AC-69: Template contract header present in BUILD_TEMPLATE for `{score_context}`
- AC-70: Cumulative threshold configurable via `scoring.cumulative-threshold`

## New Edge Cases

| Scenario | Behavior |
|----------|----------|
| Two `ralph run` in same repo | Second run exits with error: "Another run active (PID N)" |
| Lockfile exists but PID dead | Stale lock deleted, new run proceeds |
| 3 consecutive discards, then pass | Baseline recalibrated after 3rd discard; 4th iteration compared against recalibrated baseline |
| Cumulative drop of 0.11 over 8 iterations (each <0.02) | Reverted at iteration where cumulative threshold (0.10) exceeded |
| `--baseline-score 0.5` with first iteration scoring 0.9 | Score logged as 0.9, but regression check uses 0.5 as baseline — no revert |
| Score script creates temp files | Post-scoring dirty check restores working tree |
| Agent creates `.ralph/keep` | File ignored for revert decision, deleted with warning |
| `--no-score` with validation failure | Results.tsv entry written with status `fail`, score `—` |
| `.git/index.lock` exists from crashed agent | Removed before revert proceeds |
