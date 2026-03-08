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
