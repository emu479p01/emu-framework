# Set up a development environment

## Prerequisites

Use Node.js 24.18.0 and pnpm 11.12.0. The repository also provides a portable Windows runtime in `.tools` after running `RunApp.cmd`.

## Procedure

1. Clone the repository and run `pnpm install`.
2. Run `pnpm dev` for the API on port 3399 and Vite on port 5199.
3. Sign in with the seeded development account `admin` / `admin`.
4. Run `pnpm typecheck`, `pnpm test`, and `pnpm build` before proposing changes.

Development credentials are for local databases only.

## Related topics

[Architecture](architecture.md) · [Testing](testing.md)
