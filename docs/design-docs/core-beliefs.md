# Core Beliefs

Principles that guide how agents and developers work in this codebase.

1. **Repo is the system of record** — All architectural decisions, patterns, and conventions are documented in the repository. If it's not in the repo, it doesn't exist.

2. **Validate data at boundaries** — External input is untrusted. Validate at the edge (API handlers, CLI argument parsing, file reads), then trust internal data structures.

3. **Prefer shared utilities over hand-rolled helpers** — Before writing a helper function, check if one already exists. Duplication creates drift.

4. **Make the implicit explicit** — Configuration over convention when the convention isn't obvious. Document non-obvious decisions where they're made.

5. **Small, focused files** — Each file should have a clear, singular purpose. When a file grows beyond its scope, split it.
