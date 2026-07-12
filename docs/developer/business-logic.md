# Add business logic

Use table hooks for record validation/defaults, events for pre/post behavior, and named actions for explicit server operations. Execute related writes inside a transaction through `DataContext`.

Keep validation deterministic, avoid network calls inside database transactions, and enforce authorization on the server even when the client hides an action. Test success, rejection, rollback, and concurrent behavior.

Designer script artifacts are appropriate for supported dynamic behavior; native integrations still belong in reviewed TypeScript code.

## Related topics

[Architecture](architecture.md) · [Testing](testing.md)
