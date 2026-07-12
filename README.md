<p align="center"><img src="docs/assets/logo.svg" alt="EmuFramework" width="120"></p>

# EmuFramework

EmuFramework is a metadata-driven TypeScript framework for building business applications. It includes a browser-based Designer, generated forms and lists, role-based security, SQLite storage, reporting, import/export, and Docker deployment.

Current framework version: **0.0.1.0**

## Quick start on Windows

1. Download and extract the [latest release](https://github.com/emu479p01/emu-framework/releases).
2. Double-click `RunApp.cmd`.
3. Sign in at the address that opens with `admin` / `admin`.
4. Change the default password before using the system with real data.

Node.js 24.18.0 and pnpm 11.12.0 are downloaded into `.tools` automatically. For Docker, start with the [Docker installation guide](docs/admin/docker-install.md).

## Documentation

Open the [Documentation Index](docs/README.md) and choose a path:

- **User:** sign in, navigate, and build apps in the Web Designer.
- **Administrator:** install, configure, update, back up, restore, and recover the system.
- **Developer:** understand the architecture and extend the framework safely.

## Project packages

- `@emu/core` — metadata registry, database, security, and business logic.
- `@emu/server` — Fastify API and system services.
- `@emu/client` — Vue web application and Designer.
- `@emu/cli` — app and metadata scaffolding.
- `@emu/mcp` — AI development integration.

## Project links

- [Releases](https://github.com/emu479p01/emu-framework/releases)
- [Contributing](CONTRIBUTING.md) — for people proposing changes through GitHub
- [MIT License](LICENSE)
