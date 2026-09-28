<p align="center"><img src=".github/assets/logo.svg" alt="EmuFramework" width="120"></p>

# EmuFramework

EmuFramework is a metadata-driven TypeScript framework for building and operating business applications. This repository contains the framework source, tests, container definitions, and release tooling. Installation guides, tutorials, usage instructions, and detailed reference material live in the separate [EmuFramework documentation repository](https://github.com/emu479p01/emu-framework-docs).

Current framework version: **1.4.0**

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
## FU — EmuFramework v1.4.0

### Summary

Draft-based record creation, audit field aliases, UTC datetimes, image input for Functions, configurable branding and collapsible deployment previews.

### Improvements

- New records open as encrypted, user-bound drafts: `initValue` results (including read-only document numbers) are shown without inserting a row, and saving is atomic, retry-safe and survives a restart. Expired drafts, other users' drafts and drafts created before a metadata change are rejected; failed saves roll back and keep the draft usable.
- Read-only virtual audit fields `sys_createdBy`, `sys_createdAt`, `sys_modifiedBy` and `sys_modifiedAt` can be listed, filtered, sorted and used in Views. Updates preserve the original creation audit and ignore forged audit values.
- Datetimes are stored and returned in UTC and shown in the browser time zone. Numbers are displayed with grouping; IDs, references and strings are not reformatted.
- Functions can declare `imageInput` to receive JPEG, PNG or WebP images attached to a record, selected from files or the camera. Uploads are deduplicated, signature-checked, permission-checked and retried per file. WebP attachments can be previewed.
- `EMU_APP_TITLE` brands the browser title, login and setup pages. Deployment previews start collapsed with counts and show where moved or deleted artifacts came from.

### Breaking changes and migration

Lifecycle hooks (`initValue`, `validateWrite`, `validateDelete`) and data event handlers must be synchronous; async functions or returned Promises now raise an error instead of running outside the transaction. Move awaited work into an async Function. System field names are reserved case-insensitively, and schema sync stops without changes if a stored column collides with an audit alias. Datetime values without an offset are interpreted as UTC and returned with `Z`. Table metadata from `/api/metadata` now includes the system fields.

### Upgrade notes

Back up the data and designer databases together. Update application and updater images together to 1.4.0. Draft storage is created automatically; no data migration is required. Review scripts for async lifecycle handlers before upgrading. Read [Record lifecycle, audit fields and Function images](docs/record-lifecycle-and-images.md) for details.

### Validation

Version consistency, type checking, production builds and automated tests pass on Node 24 (135 core, 45 client, 162 server and 6 release-policy tests; one optional legacy-backup fixture test is skipped). The 1.3.0-to-1.4.0 persistent-database upgrade check passed for existing login, business/audit/datetime data, CUS extension fields, existing `initValue` scripts, Recent/Favorites, legacy package preview, and an encrypted draft saved after restart. This branch is not published.

### Known issues

Drafts invalidated by a metadata change must be reopened; entered values stay in the open page but are not transferred automatically. Uploaded images remain attached when the Function fails. External side effects cannot be rolled back. New long-tail administration/Designer labels remain English.
<!-- release-notes:end -->

## Repository structure

- `packages/core` — metadata registry, SQLite data access, schema synchronization, security, and business logic.
- `packages/server` — Fastify APIs, Web Designer services, AI proposal workflow, backup/restore, and system maintenance.
- `packages/client` — Vue web application and Web Designer.
- `docs` — developer guides for metadata features introduced by each release, starting with [localization and Data Entity extensions](docs/developer-guide.md).
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
