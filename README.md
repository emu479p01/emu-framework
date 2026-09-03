<p align="center"><img src=".github/assets/logo.svg" alt="EmuFramework" width="120"></p>

# EmuFramework

EmuFramework is a metadata-driven TypeScript framework for building business applications. It includes a browser-based Web Designer, generated forms and lists, layered customization, role-based security, SQLite storage, reporting, import/export, reviewed AI proposals, and Docker deployment.

Current framework version: **1.0.0**

## Release notes — v1.0.0

EmuFramework v1.0.0 is a complete metadata-driven platform for building and operating business applications without maintaining a separate frontend and backend for every App. It provides:

- A browser-based Web Designer for defining Apps, data models, forms, lists, line grids, menus, permissions, reports, views, Functions, and Scripts.
- Automatically generated responsive business UIs backed by SQLite, including validation, lookups, navigation, resizable grids, multiline text, import/export, and reporting.
- Layered metadata customization so standard solutions can be extended without modifying their original definitions.
- Role-based access control, record and Function permissions, audit-friendly workflows, encrypted fields and integration secrets, and safe authenticated deep links.
- Server-side Functions and Scripts for business rules, transactions, integrations, asynchronous work, and confirm-before-run Function deep links with arguments.
- REST APIs for business applications, external reporting and Power BI Views, plus a reviewed AI proposal workflow that never applies metadata changes automatically.
- Docker-based deployment with persistent storage, backup and restore, health diagnostics, and an idempotent upgrade path for existing EmuFramework installations.

## Quick start with Docker

Requirements:

- Docker Engine or Docker Desktop with Docker Compose
- Port `3399` available, or set a different `PORT`

1. Download `docker-compose.yml` from this repository.
2. Create a `.env` file beside it and set an updater token containing at least 24 characters:

   ```dotenv
   EMU_UPDATER_TOKEN=replace-with-a-long-random-secret
   EMU_VERSION=1.0.0
   PORT=3399
   ```

3. Pull and start the application:

   ```console
   docker compose pull
   docker compose up -d
   ```

4. Read the one-time administrator setup code:

   ```console
   docker compose logs app
   ```

5. Open `http://localhost:3399`, complete administrator setup, and create Apps, Models, and Artifacts through the Web Designer.

Production data is stored in the persistent `emu-data` Docker volume:

- `/data/data.db` — business and framework records
- `/data/designer.db` — metadata, Designer state, AI tokens, proposals, and audit records
- `/data/.emu-secret.key` — encryption key stored separately from database backups

Do not run multiple writer containers against the same SQLite volume.

## Upgrade from an earlier version

1. Stop the earlier application so no process can write either SQLite database.
2. Create a full backup of `data.db` and `designer.db`.
3. Preserve `.emu-secret.key` or the Docker secret configured by `EMU_SECRET_KEY_PATH`; this key is intentionally not included in database backups.
4. Copy or mount the existing files into the persistent Docker volume as `/data/data.db` and `/data/designer.db`.
5. Set `EMU_VERSION=1.0.0`, then pull and start the Docker stack.
6. Allow the idempotent metadata/index migration to finish and verify login, business data, important Scripts/Functions, and **Settings → System Maintenance** diagnostics.

When a string field is changed to `encrypted: true`, existing plaintext values are migrated transactionally. Preserve `.emu-secret.key` (or the file configured by `EMU_SECRET_KEY_PATH`) across every update and restore; losing it makes encrypted business fields and integration passwords unrecoverable. Encrypted fields cannot be title, index, filter, sort, search, or import-key fields.

If migration or health checks fail, stop the new container and restore the untouched backup. Never open the same database volume with the old and new versions simultaneously.

## Web Designer and AI REST API

Users create and maintain Apps, Models, and Artifacts through the Web Designer. Existing session-cookie CRUD endpoints remain reserved for the Designer.

AI integrations use dedicated Bearer tokens and the versioned endpoints below:

- `GET /api/v1/ai/capabilities`
- `GET /api/v1/ai/schemas/artifact`
- `GET /api/v1/ai/schemas/change-set`
- `GET /api/v1/ai/workspace`
- `POST /api/v1/ai/change-sets/validate`
- `POST /api/v1/ai/proposals`

AI tokens support `inspect`, `validate`, and `propose` scopes and can be restricted to selected Apps. There is no AI apply endpoint and no AI business-record endpoint. Every proposal requires review and approval in the Web Designer.

## Documentation

Open the [Documentation Index](https://github.com/emu479p01/emu-framework-docs) and choose a path:

- **User:** sign in, navigate, and build Apps in the Web Designer.
- **Administrator:** deploy with Docker, configure access, update, back up, restore, and inspect SQLite health.
- **Developer:** understand metadata, Layer behavior, Function/Script APIs, REST integration, and framework architecture.

Additional references:

- [Security and permission matrix](https://github.com/emu479p01/emu-framework-docs/blob/main/developer/security.md)
- [Power BI View API guide](https://github.com/emu479p01/emu-framework-docs/blob/main/admin/power-bi-view-api.md)
- [Docker installation guide](https://github.com/emu479p01/emu-framework-docs/blob/main/admin/docker-install.md)

## Project packages

- `@emu/core` — metadata registry, SQLite data access, schema synchronization, security, and business logic.
- `@emu/server` — Fastify APIs, Web Designer services, AI proposal workflow, backup/restore, and system maintenance.
- `@emu/client` — Vue web application and Web Designer.

## Development

The repository toolchain uses Node.js 24.18.0 and pnpm 11.12.0. Production execution is Docker-only; local commands are intended for framework development and verification:

```console
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
```

## Project links

- [Releases](https://github.com/emu479p01/emu-framework/releases)
- [Documentation](https://github.com/emu479p01/emu-framework-docs)
- [Contributing](CONTRIBUTING.md)
- [MIT License](LICENSE)
