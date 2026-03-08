# Architecture — ralph-cli

## Domains

<!-- List your domain boundaries and their responsibilities -->

| Domain | Path | Responsibility |
|--------|------|----------------|
| <!-- e.g., auth --> | <!-- e.g., src/domain/auth --> | <!-- e.g., Authentication and authorization --> |

## Layers

Dependencies flow downward only — each layer may only import from layers above it.

1. **types** — Type definitions, interfaces, schemas
2. **config** — Configuration loading and validation
3. **data** — Data access, repositories, external API clients
4. **service** — Business logic, orchestration
5. **ui** — User interface, CLI handlers, API routes

## Cross-Cutting Concerns

<!-- Modules allowed to be imported by any layer -->

## Dependency Rules

- No circular dependencies between domains
- Each layer can only import from layers above it in the list
- Cross-cutting concerns are exempt from layer restrictions
- File size limit: 500 lines per file
