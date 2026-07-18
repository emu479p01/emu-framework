<p align="center"><img src=".github/assets/logo.svg" alt="EmuFramework" width="120"></p>

# EmuFramework

EmuFramework is a metadata-driven TypeScript framework for building business applications. It includes a browser-based Designer, generated forms and lists, role-based security, SQLite storage, reporting, import/export, and Docker deployment.

Current framework version: **0.1.1.0 (Beta)**

## Quick start on Windows

1. Download and extract the [latest release](https://github.com/emu479p01/emu-framework/releases).
2. Double-click `RunApp.cmd`.
3. On first run, open the setup page and enter the one-time code printed by the server or Docker logs. Choose the administrator username and a password of at least 12 characters.

## v0.1.1.0 security, analytics, and explicit Models

- Administrator access is role-based. A username such as `admin` has no special access unless it holds `FW_SystemAdminRole`.
- Access is deny-by-default: `FW_AppAccess.canOpen` controls entry to an App, while Role → Duty → Privilege controls forms, tables, functions, reports, and Views inside it. Both must allow the request.
- `canCustomize` grants Designer access only to that App and never grants runtime data access. `FW_FrameworkUser` is legacy and no longer bypasses App scope.
- New Apps start with zero Models. Create a named Model and choose its Layer before creating artifacts; Model groups development metadata and is not a security boundary.
- Declarative View artifacts provide validated joins, filters, typed parameters, grouping and aggregates without raw SQL. JSON/CSV endpoints and scoped, revocable service tokens support Power BI Web connections.
- Reusable bar, line, pie, donut and KPI Chart artifacts can be embedded after Form groups and before line grids.
- User creation, Role/App Access assignment, password reset, and View tokens are managed under **Settings → Users & Security**. Every user can change their own password under **My Account**.
- Functions default to synchronous `transactional` execution. Select `async` to use `await services.http.request(...)` or `await services.email.send(...)` without holding a database transaction open.
- Configure SMTP under **Settings → SMTP Settings**. Its password is encrypted in `designer.db`; preserve the separate `.emu-secret.key` file (or the path configured by `EMU_SECRET_KEY_PATH`) when moving an installation. Database backups intentionally do not contain this key.

See the [release notes](https://github.com/emu479p01/emu-framework-docs/blob/main/release-notes.md), [security and permission matrix](https://github.com/emu479p01/emu-framework-docs/blob/main/developer/security.md), and [Power BI View API guide](https://github.com/emu479p01/emu-framework-docs/blob/main/admin/power-bi-view-api.md).

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
