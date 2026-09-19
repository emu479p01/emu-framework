<p align="center"><img src=".github/assets/logo.svg" alt="EmuFramework" width="120"></p>

# EmuFramework

EmuFramework is a metadata-driven TypeScript framework for building and operating business applications. This repository contains the framework source, tests, container definitions, and release tooling. Installation guides, tutorials, usage instructions, and detailed reference material live in the separate [EmuFramework documentation repository](https://github.com/emu479p01/emu-framework-docs).

Current framework version: **1.1.0**

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
## FU — EmuFramework v1.1.0

### Summary

This framework update adds localized metadata labels, personal navigation, record attachments, document-level Data Entity exchange, governed business-data archiving, storage monitoring, and a substantially expanded Report Designer.

### Improvements

- Adds BCP-47 metadata translations with per-user locale and exact-locale, base-language, and default-label fallback.
- Adds server-backed Favorites and the ten most recent authorized navigation items per user.
- Adds file, note, and URL attachments to saved header and line records with opaque storage keys, SHA-256 integrity, streaming upload/download, configurable limits, and parent-record permissions.
- Adds separate `/files` and `/archive` Docker volumes while retaining shared `/data` fallbacks with administrator warnings.
- Adds Header/Line Data Entities with XLSX sheets or manifest-based CSV ZIP packages, durable staging, per-document atomic upsert, and downloadable error files.
- Adds opt-in archive policies for explicitly eligible Data Entities, immutable checksummed payloads and blobs, scheduled batches, read-only search, collision-safe restore, and job history.
- Adds a Storage & Archive dashboard with filesystem capacity, database/WAL, backup, font, live-file, archive, and per-App database usage.
- Expands Report Designer with A3, A4, A5, Letter, Legal, and custom paper; orientation; four margins; cm, inch, and pixel display units; strict layout validation; text/field borders; and PNG/JPEG images from bundled assets or record attachments.
- Extends backup schema version 4 with live files and archive data, streaming backup downloads, and backward-compatible restore validation.

### Breaking changes and migration

No existing metadata or API contract is removed. New metadata kinds and fields are additive. Official Docker deployments should add the `emu-files:/files` and `emu-archive:/archive` named volumes and set `EMU_FILE_STORAGE_PATH=/files` and `EMU_ARCHIVE_STORAGE_PATH=/archive`. Existing deployments continue to boot with `/data/files` and `/data/archive`, but the administration page warns that shared fallback storage is in use.

Reports remain compatible as layout version 1. Existing overflowing reports can still preview with warnings. A report saved from the updated designer becomes layout version 2 and must pass the printable-area validator.

### Upgrade notes

Create a full backup, preserve `.emu-secret.key`, and update the application and updater images together to `1.1.0`. Before stopping the application, the updater verifies that the application and updater see the same separate file and archive mounts. After restart, verify **Settings → System Maintenance → Storage & Archive**, configure archive policies only for declared Data Entities, and confirm attachment upload/download permissions.

Plan SSD capacity for databases, WAL, backups, live attachments, archive payloads, and rollback headroom. A practical baseline is 200 GB for a 4-vCPU/8-GB server; use 100 GB only for light deployments without material attachment growth, and 500 GB or more for file-heavy workloads.

### Validation

The candidate is required to pass version consistency, release-policy tests, core/server/client type checking, all automated tests, production builds, and the isolated local Docker acceptance gate without dependency installation or network pulls. Docker acceptance covers fresh install, upgrade, failed-health rollback, interrupted maintenance recovery, restore rollback, byte equality, mount-continuity rejection, and attachment backup/restore.

### Known issues

Archive data is retained indefinitely in this release; automatic archive purge is intentionally not provided. Legacy `.xls` files are not accepted by Data Entities. Attachment versioning and check-in/check-out are not included. Framework UI strings, runtime error messages, and business record values are not translated by metadata translation resources.
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
