# Meta-Prompt: Fitness Scoring Spec Hardening (Round 2)

You are performing a deep adversarial analysis of a product specification before it enters a build loop. Your job is to find every hole, contradiction, ambiguity, and failure vector — then fill each one with a concrete, implementable solution written directly into the spec.

## Context

- **Project:** ralph-cli — a CLI tool that prepares and maintains repositories for AI agent development
- **Spec under review:** `docs/product-specs/fitness-scoring.md` (838 lines, 11 features, 71 acceptance criteria)
- **Codebase:** `/home/molt/projects/ralph-cli/` — TypeScript, ESM, vitest, 685 tests, v0.4.0
- **Branch:** `feature/fitness-scoring`
- **What happens next:** This spec gets fed to `ralph run plan` → `ralph run` (autonomous build loop). An LLM agent reads the spec and implements it task by task with fresh context each iteration. Every ambiguity becomes a coin flip. Every contradiction becomes a bug.

## Your Mission

Ultrathink through every layer of this spec. You are the last line of defense before autonomous agents build from this document.

### Phase 1: Structural Integrity (read everything first)

Read the full spec (`docs/product-specs/fitness-scoring.md`). Then read:
- The existing codebase that this spec modifies: `src/commands/run/index.ts`, `src/commands/run/types.ts`, `src/commands/run/prompts.ts`, `src/commands/run/progress.ts`, `src/commands/run/agent.ts`, `src/commands/run/detect.ts`
- The config system: `src/config/schema.ts`, `src/config/defaults.ts`, `src/config/loader.ts`, `src/config/validate.ts`
- The CLI registration: `src/cli.ts`
- The existing test patterns: pick 2-3 test files to understand conventions

Map every reference in the spec to where it lands in the codebase. Flag:
- **Dangling references:** spec mentions a file, function, or interface that doesn't exist yet AND isn't clearly marked as "new"
- **Shadow conflicts:** spec defines something that collides with an existing name, export, or pattern
- **Import chain gaps:** spec says A imports B imports C — verify the chain is complete and no circular deps form

### Phase 2: Contradiction Hunting

For every behavioral rule in the spec, check if another rule contradicts it. Specifically:
- Threshold comparisons: strictly less than vs less than or equal — are all boundary cases consistent?
- Status definitions: does every flow path produce exactly one of `pass | fail | timeout | discard`? Can any path produce none? Can any path produce two?
- Config defaults vs hardcoded values: are there any places where a default can be overridden to a value that breaks a hardcoded assumption?
- Flag interactions: `--no-score` × `--simplify` × `--baseline-score` × `--force` × `--mode plan` — enumerate all 2-way and 3-way combinations. Are all invalid combos caught?

### Phase 3: Agent-as-Adversary

The build agent will read this spec and implement it. But agents:
- Take the literal shortest path to satisfying acceptance criteria
- May implement AC-X in a way that technically passes but breaks the intent
- Will not infer unstated constraints
- May create files in unexpected locations if the spec is ambiguous about paths

For each feature (F-FS01 through F-FS11), ask:
- What's the laziest correct implementation? Does it still satisfy the design principles?
- What information would an agent need that isn't in the spec?
- If the agent implements this feature in isolation (no context from other features), what breaks?

### Phase 4: Runtime Failure Simulation

Walk through these scenarios step by step, checking every line of the spec's pseudocode:

1. **First run ever:** No `.ralph/` directory. No `results.tsv`. No checkpoint. No score script. Default config. What happens at each step?
2. **Resume after crash:** Checkpoint exists with `lastScore: 0.85`, `bestScore: 0.90`, `consecutiveDiscards: 2`. Agent crashes mid-iteration (SIGKILL). What state is the repo in? What happens on resume?
3. **Score oscillation:** Scores alternate 0.85, 0.83, 0.86, 0.82, 0.87, 0.81... Per-iteration threshold (0.02) fires every other iteration. Cumulative threshold? Baseline recalibration?
4. **Zero to hero:** Project starts with 0 tests, no coverage. Default scorer produces `null`. Agent adds 50 tests in iteration 1. What score? What baseline?
5. **Score script returns 1.0 every time:** Valid but useless. Does the loop handle constant scores gracefully? Delta is always 0. Cumulative delta is always 0.
6. **Validation passes but scoring hangs:** Test command exits 0, typecheck exits 0, score script blocks forever (60s timeout). What status? What gets logged?
7. **Agent commits to wrong branch:** Agent runs `git checkout main` during its iteration. Baseline commit is on `feature/fitness-scoring`. `git reset --hard <baseline>` — does it work across branches?

### Phase 5: Synthesis

For every hole found:
1. Classify: ambiguity | contradiction | coverage gap | edge case | agent trap
2. Assess severity: critical (will cause build failure) | high (will cause wrong behavior) | medium (cosmetic or unlikely)
3. Write the fix: exact text to add/change in the spec. Be specific — line-level if possible.
4. Write the AC: if the fix needs a new acceptance criterion, write it in the spec's format

## Output Format

Produce your analysis as a structured report, then apply all fixes directly to `docs/product-specs/fitness-scoring.md`. The spec must be self-consistent and complete when you're done.

### Report Structure

```
## Findings

### [ID]: [Title]
- **Type:** ambiguity | contradiction | coverage gap | edge case | agent trap
- **Severity:** critical | high | medium
- **Location:** Feature + section in spec
- **Problem:** What's wrong
- **Fix:** What to change (exact spec text)
- **AC:** New acceptance criterion if needed
```

After the findings report, apply all fixes to the spec file. Commit with message: `docs: fitness-scoring spec hardening round 2 — N fixes applied`.

## Constraints

- Do NOT add new features. Only harden existing ones.
- Do NOT change the architecture. Only clarify and tighten it.
- Every fix must be implementable by an agent reading only this spec.
- Prefer explicit over implicit. If something "should be obvious," write it down.
- When in doubt, add an edge case row to the Edge Cases table rather than leaving it unstated.
