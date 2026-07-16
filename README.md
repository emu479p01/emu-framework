<p align="center"><img src=".github/assets/logo.svg" alt="EmuFramework" width="120"></p>

# EmuFramework

EmuFramework is a metadata-driven TypeScript framework for building business applications. It includes a browser-based Designer, generated forms and lists, role-based security, SQLite storage, reporting, import/export, and Docker deployment.

Current framework version: **0.1.0.2 (Beta)**

## Quick start on Windows

1. Download and extract the [latest release](https://github.com/emu479p01/emu-framework/releases).
2. Double-click `RunApp.cmd`.
3. On first run, open the setup page and enter the one-time code printed by the server or Docker logs. Choose the administrator username and a password of at least 12 characters.

## v0.1.0.2 security and integrations

- Administrator access is role-based. A username such as `admin` has no special access unless it holds `FW_SystemAdminRole`.
- App Access controls which apps are visible; Role/Duty/Privilege controls forms, functions, reports, and data inside those apps.
- Functions default to synchronous `transactional` execution. Select `async` to use `await services.http.request(...)` or `await services.email.send(...)` without holding a database transaction open.
- Configure SMTP under **Settings → SMTP Settings**. Its password is encrypted in `designer.db`; preserve the separate `.emu-secret.key` file (or the path configured by `EMU_SECRET_KEY_PATH`) when moving an installation. Database backups intentionally do not contain this key.
4. Change the default password before using the system with real data.

Node.js 24.18.0 and pnpm 11.12.0 are downloaded into `.tools` automatically. For Docker, start with the [Docker installation guide](https://github.com/emu479p01/emu-framework-docs/blob/main/admin/docker-install.md).

## Documentation

Open the [Documentation Index](https://github.com/emu479p01/emu-framework-docs) and choose a path:

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
