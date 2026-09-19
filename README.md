<p align="center"><img src=".github/assets/logo.svg" alt="EmuFramework" width="120"></p>

# EmuFramework

EmuFramework is a metadata-driven TypeScript framework for building and operating business applications. This repository contains the framework source, tests, container definitions, and release tooling. Installation guides, tutorials, usage instructions, and detailed reference material live in the separate [EmuFramework documentation repository](https://github.com/emu479p01/emu-framework-docs).

Current framework version: **1.0.1**

## What it provides

- A browser-based Web Designer for defining Apps, models, forms, lists, menus, views, reports, Functions, Scripts, and permissions.
- Generated responsive business interfaces backed by SQLite, including validation, lookups, line grids, import/export, charts, and reporting.
- Layered metadata customization so solutions can be extended without modifying their original definitions.
- Role-based access control, record and Function permissions, encrypted fields and integration secrets, and authenticated deep links.
- Server-side Functions and Scripts for business rules, transactions, integrations, and asynchronous work.
- REST integration, external reporting and Power BI Views, plus an AI proposal workflow in which metadata changes require human review and approval.
- Docker deployment with persistent storage, backup and restore, health diagnostics, and guarded update recovery.

These capabilities are implemented and tested in the `@emu/core`, `@emu/server`, and `@emu/client` packages in this repository.

## Documentation

Use the [Documentation Index](https://github.com/emu479p01/emu-framework-docs) for:

- installation and upgrade guides;
- user and administrator tutorials;
- Web Designer and framework usage;
- APIs, security, architecture, testing, and other detailed reference material.

This README is intentionally a project landing page rather than a second copy of the manual.

## Versioning and release types

New framework releases use exactly three components: **`Major.Minor.Patch`**.

- **FU — Framework Update:** a breaking structural change increments `Major` and resets `Minor.Patch` to `0.0`; important backward-compatible functionality increments `Minor` and resets `Patch` to `0`.
- **PU — Proactive Update:** bug fixes, hotfixes, and security fixes increment `Patch`.
- A release containing more than one kind of change is classified by its highest-impact change.
- Legacy four-component tags are immutable history. They remain available but are not extended or reused.

The latest canonical English release note remains below because the release workflow copies this marked block into the GitHub Release. The [release-note archive](release-notes/README.md) contains historical notes and guidance for future releases.

<!-- release-notes:start -->
## PU — EmuFramework v1.0.1

### Summary

This proactive update improves the AI Proposal Inbox and makes container-based framework updates and restores safer to operate and recover.

### Improvements

- Adds status filtering, refresh controls, expand/collapse controls, clearer loading states, and responsive proposal cards to the AI Proposal Inbox.
- Allows reviewed proposals to be removed from the Inbox without removing applied metadata or AI audit records.
- Adds a health endpoint and container health check for the updater service.

### Fixes

- Rejects unpublished update images before changing the running application container.
- Restores the previous container when an update fails after restart begins, and records background update failures reliably.
- Detects interrupted update and restore jobs when the updater restarts, recovers the application container where possible, and marks the interrupted job as failed with an actionable message.

### Breaking changes and migration

None. This release does not require a metadata or business-data migration.

### Upgrade notes

Back up `data.db` and `designer.db`, preserve `.emu-secret.key`, and update both the application and updater images to `1.0.1`. After restart, verify login and **Settings → System Maintenance** diagnostics.

### Validation

The release workflow runs the automated tests, type checking, and production builds before publishing the application and updater images.

### Known issues

None known.
<!-- release-notes:end -->

## Repository structure

- `packages/core` — metadata registry, SQLite data access, schema synchronization, security, and business logic.
- `packages/server` — Fastify APIs, Web Designer services, AI proposal workflow, backup/restore, and system maintenance.
- `packages/client` — Vue web application and Web Designer.
- `release-notes` — release-note archive, authoring template, and maintenance guidance.

## Framework development

The repository toolchain uses Node.js 24.18.0 and pnpm 11.12.0. See [Contributing](CONTRIBUTING.md) before proposing a change. The standard verification commands are:

```console
pnpm check:versions
pnpm typecheck
pnpm test
pnpm build
```

## Project links

- [Documentation](https://github.com/emu479p01/emu-framework-docs)
- [Release-note archive](release-notes/README.md)
- [GitHub Releases](https://github.com/emu479p01/emu-framework/releases)
- [Contributing](CONTRIBUTING.md)
- [MIT License](LICENSE)
