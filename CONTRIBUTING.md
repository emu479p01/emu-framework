# Contributing

## Setup

```sh
pnpm install
pnpm dev   # runs API (3399) + client (5199) together
```

Or run them in separate terminals if you prefer:

```sh
pnpm --filter @emu/server dev
pnpm --filter @emu/client dev
```

Logins: `admin/admin`, `manager/manager`, `clerk/clerk`.

## Before opening a PR

```sh
pnpm check:versions
pnpm -r typecheck
pnpm -r test
pnpm -r build
```

## Project layout

See [README.md](README.md#project-structure) for the package layout and
[docs/DEVELOPER-GUIDE.md](docs/DEVELOPER-GUIDE.md) for the full developer guide,
including how to scaffold apps/modules/objects with `pnpm emu`.
