# ralph-cli

CLI tool that prepares and maintains repositories for AI agent development.

## Build & Run

- Install deps: `npm install`
- Build: `npm run build`
- Run locally: `node dist/cli.js <command>` or `npx . <command>`
- Link for dev: `npm link` then use `ralph <command>`

## Validation

Run these after implementing to get immediate feedback:

- Tests: `npm test`
- Typecheck: `npx tsc --noEmit`
- Lint: `npm run lint`

## Architecture

- Entry point: `src/cli.ts` — command router using a CLI framework (commander, yargs, or similar)
- Commands live in `src/commands/` — one file per command (`init.ts`, `lint.ts`, `grade.ts`, etc.)
- Shared utilities in `src/lib/` — config loading, file operations, markdown parsing, rule engine
- Templates in `src/templates/` — the files that `ralph init` generates (AGENTS.md, ARCHITECTURE.md, docs structure)
- Rules in `src/rules/` — built-in architectural rules for `ralph lint`
- Config schema in `src/lib/config.ts` — validates `.ralph/config.yml`

## Key Decisions

- TypeScript with strict mode
- ESM modules
- Minimal dependencies — prefer stdlib over packages where reasonable
- All output is plain text/markdown — no binary formats
- LLM-agnostic — zero references to specific AI providers or model names anywhere in source or templates

## Operational Notes

(Updated by Ralph as learnings accumulate)
