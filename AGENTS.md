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

- Entry point: `src/cli.ts` — command router using commander
- Commands: `src/commands/<name>/index.ts` — one directory per command (init/, lint/, grade/, doctor/, plan/, promote/, ref/, gc/, hooks/, ci/)
- Config system: `src/config/` — schema.ts (types), loader.ts (find + parse + merge), validate.ts, defaults.ts
- Shared utilities: `src/utils/` — fs.ts (ensureDir, safeReadFile, safeWriteFile), output.ts (colored console)
- Lint subsystem: `src/commands/lint/` — engine.ts (rule framework), imports.ts (parser), files.ts (collector), rules/ (built-in + custom)

## Key Decisions

- TypeScript with strict mode
- ESM modules
- Minimal dependencies — prefer stdlib over packages where reasonable
- All output is plain text/markdown — no binary formats
- LLM-agnostic — zero references to specific AI providers or model names anywhere in source or templates

## Operational Notes

- `exactOptionalPropertyTypes` in tsconfig: optional interface properties must use `| undefined` (e.g., `description?: string | undefined`)
- YAML 1.2 (yaml package): regex patterns with backslashes must use single quotes in `.yml` files (e.g., `pattern: 'console\\.log'`)
- ESM: never use `require()` — use `import` statements. All `.ts` imports resolve to `.js` in compiled output.
- `vitest.config.ts` excludes `dist/` to prevent running compiled test copies. `tsconfig.json` has `"include": ["src"]` to exclude vitest.config.ts from compilation.
- Tests use `process.chdir()` to temp dirs with `.git/` stubs. Always restore `origCwd` in `afterEach`.
- Config loading walks up directories looking for `.ralph/config.yml`. Falls back to defaults gracefully.
