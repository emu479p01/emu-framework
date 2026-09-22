<p align="center"><img src=".github/assets/logo.svg" alt="EmuFramework" width="120"></p>

# EmuFramework

EmuFramework is a metadata-driven TypeScript framework for building and operating business applications. This repository contains the framework source, tests, container definitions, and release tooling. Installation guides, tutorials, usage instructions, and detailed reference material live in the separate [EmuFramework documentation repository](https://github.com/emu479p01/emu-framework-docs).

Current framework version: **1.3.0**

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
## FU — EmuFramework v1.3.0

### Summary

App-local Recent navigation, selected-model deployments, Apps & Models administration, and optional offline ISV licensing.

### Improvements

- Sidebar activity follows the original app menu, including Recent shortcuts and record detail routes. Recent history retains ten entries per user per app, with a separate Settings history and existing Favorites preserved.
- Designer builds complete selected-model packages for vendor updates (SYS/ISV/LOC) or UAT-to-Prod promotion (all layers). Preview identifies metadata additions, changes, removals and preserved models; ownership conflicts, missing dependencies and incompatible customizations block deployment. Unselected models and physical business data are retained.
- Change-set apply revalidates the candidate and restores runtime registrations and database changes on synchronous apply/persistence failures.
- System administration lists app/model layers, source, metadata revisions, dependencies, deployment history and license state.
- Optional ISV requirements use installation/customer-bound Ed25519 license files, a seller CLI, vendor trust registration, monotonic renewal sequences and audit records. Expiry restricts the app and dependent apps to read-only use; renewal takes effect without redeployment.

### Breaking changes and migration

None for existing apps and packages. License tables are created automatically in the designer database; existing models remain unlicensed. Recent returns an additional app property and up to ten entries per app rather than ten globally. Selected-model packages use schema version 2 and require 1.3.0 at the destination; legacy version-1 packages remain supported.

### Upgrade notes

Back up the data and designer databases together. Update application and updater images together to 1.3.0. Use metadata packages for UAT-to-Prod promotion; each environment keeps its own installation identity and licenses. Read [Model deployment and ISV licenses](docs/deployment-and-isv-licenses.md) for deployment modes, seller CLI usage, renewal and recovery.

### Validation

Version consistency, type checking, production builds and automated tests pass (131 core, 39 client, 155 server and 6 release-policy tests; one optional legacy-backup fixture test is skipped). Tests use Node 24 and bounded worker concurrency. The 1.2.0-to-1.3.0 persistent-database upgrade check passed for existing login, business data, CUS fields/models, Recent/Favorites, legacy package preview and additive license storage. Browser checks verified desktop/mobile menu activity, app-local Recent, Apps & Models and layer selection in both deployment modes. Release-policy validation passes against 1.2.0. This branch is not published.

### Known issues

Offline licensing cannot prevent changes by operators controlling the server, source, database or clock, and has no online revocation or key rotation. Trusted scripts/native code are not sandboxed. External side effects cannot be rolled back; a machine failure between commits to the separate data/designer databases requires backup recovery. Dynamic customizations still require UAT validation. New long-tail administration/Designer labels remain English. License notices in an already-open page update on refresh.
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
