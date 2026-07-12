# Contributing to EmuFramework

This file is for people who want to propose code or documentation changes through a GitHub Pull Request. It is not an application user manual; users should start at the [Documentation Index](docs/README.md).

## Prepare a change

1. Fork the repository on GitHub and clone your fork.
2. Create a short-lived branch from the current default branch.
3. Run `pnpm install` with Node.js 24.18.0 and pnpm 11.12.0.
4. Make one focused change and add or update tests.
5. Do not commit databases, `.env` files, `.tools`, build output, or credentials.

Run the app with `pnpm dev`. Development accounts are documented in [Developer setup](docs/developer/setup.md) and must never be used in production.

## Verify the change

Run these commands before opening a Pull Request:

```sh
pnpm check:versions
pnpm typecheck
pnpm test
pnpm build
```

## Open a Pull Request

1. Push the branch to your fork.
2. Describe the problem, the chosen solution, and how it was tested.
3. Include screenshots for visible UI changes.
4. Mention migrations, compatibility risks, or documentation changes.
5. Respond to review comments with additional commits; do not rewrite unrelated code.

See [Testing](docs/developer/testing.md) and [Architecture](docs/developer/architecture.md) for more detail.
