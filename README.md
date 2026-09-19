<p align="center"><img src=".github/assets/logo.svg" alt="EmuFramework" width="120"></p>

# EmuFramework

EmuFramework is a metadata-driven TypeScript framework for building and operating business applications. This repository contains the framework source, tests, container definitions, and release tooling. Installation guides, tutorials, usage instructions, and detailed reference material live in the separate [EmuFramework documentation repository](https://github.com/emu479p01/emu-framework-docs).

Current framework version: **1.0.2**

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
## PU — EmuFramework v1.0.2

### Summary

This proactive update makes container updates and restores durable, removes unauthorized actions from delivered metadata, and corrects Report Designer canvas sizing.

### Improvements

- Adds an atomic, phase-based maintenance journal with explicit rollback and recovery-required status.
- Checkpoints and closes both SQLite databases during graceful application shutdown.

### Fixes

- Restores the previous container and the pre-operation persistent-data snapshot when update health verification fails.
- Compensates interrupted update and restore phases idempotently and retains recovery artifacts when automated rollback cannot finish.
- Requires stable `X.Y.Z` update targets and supports a fail-closed local-image mode for unpublished test images.
- Omits unauthorized form and line actions from `/api/metadata`, while direct action calls continue to return `403`.
- Filters hidden or disabled actions defensively in the client.
- Calculates Report Designer canvas width from left and right margins, including asymmetric margins.

### Breaking changes and migration

None. The maintenance API adds optional `phase`, `rollbackStatus`, and `recoveryRequired` fields while preserving the existing `status` field.

### Upgrade notes

Back up `data.db` and `designer.db`, preserve `.emu-secret.key`, and update both the application and updater images together to `1.0.2`. After restart, verify login and **Settings → System Maintenance** diagnostics.

### Validation

The candidate passed the offline release policy, type checking, automated tests, production builds, fresh-container boot, local-image upgrade, failed-health rollback, failed-restore rollback, and byte-equality checks for restored `data.db`.

### Known issues

The local Docker acceptance stack requires Docker Desktop to be running and the previous release image to exist in the local image cache; the verifier never pulls it automatically.
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
