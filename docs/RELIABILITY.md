# Reliability

## Error Handling

- Handle errors at the appropriate level — don't swallow exceptions
- Use typed errors where the language supports it
- Fail fast on invalid state
- Log errors with enough context to debug without reproduction

## Observability

- Structured logging for machine-readable output
- Meaningful error messages for human readers

## Testing

- Test the contract, not the implementation
- Cover error paths, not just happy paths

## Auto-Revert Safety Net

The `ralph run` build loop includes a fitness-based auto-revert mechanism to
prevent regressions from accumulating across iterations.

**How it works:**

1. Before each iteration, the current fitness score is captured as a baseline.
2. After the agent commits its changes, the scorer runs again.
3. If the new score is lower than the baseline by more than `regression-threshold`
   (default 0.02), the iteration's commit is reverted with `git revert --no-edit`.
4. The agent receives a `{score_context}` block in its next prompt explaining the
   regression — which metrics changed and by how much — so it can adjust.

**Configuration:**

```yaml
scoring:
  regression-threshold: 0.02  # Drop size that triggers revert (0 = strict)
```

Setting `regression-threshold: 0` enforces strict monotonicity — any score drop
triggers a revert. Raising it (e.g., 0.05) tolerates more noise, which is useful
for non-deterministic scorers or benchmarks.

**What is and is not reverted:**

Only the agent's commit for that iteration is reverted. The revert itself is a
new commit, preserving full history. The loop continues after the revert, giving
the agent another attempt with the regression context.

## Run Lock

`ralph run` acquires a file-based lock at `.ralph/run.lock` before entering the
build loop. This prevents two concurrent `ralph run` processes from operating on
the same repository simultaneously, which could corrupt the checkpoint file or
produce conflicting commits.

**Behavior:**

- If the lock file exists when `ralph run` starts, the process prints an error and
  exits immediately.
- The lock file is released (deleted) on clean exit, on `SIGINT` (Ctrl+C), and on
  `SIGTERM`.
- If the process is killed with `SIGKILL` or crashes, the lock file is left behind.
  In that case, delete `.ralph/run.lock` manually before running again.

**Lock file location:** `.ralph/run.lock` (relative to the repo root where
`.ralph/config.yml` is found).
