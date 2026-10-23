<p align="center"><img src=".github/assets/logo.svg" alt="EmuFramework" width="120"></p>

# EmuFramework

EmuFramework is a metadata-driven TypeScript framework for building and operating business applications. This repository contains the framework source, tests, container definitions, and release tooling. Installation guides, tutorials, usage instructions, and detailed reference material live in the separate [EmuFramework documentation repository](https://github.com/emu479p01/emu-framework-docs).

Current framework version: **1.4.1**

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
## PU — EmuFramework v1.4.1

### Summary

Update the framework runtime to Node.js 24.22.1 for the October 2026 security fixes and validate application and updater containers before publishing.

### Fixes

- Upgrade Node.js from 24.18.0 to 24.22.1 in development guidance, CI, release builds and both container images. Supported Node.js ranges now start at 22.23.4 and 24.22.1.
- Replace the deprecated pnpm 11.12.0 release with 11.25.0 across the toolchain, retaining the existing dependency lockfile.
- Upgrade workflow actions to versions declaring the Node.js 24 runtime and add repository version checks to CI.
- Build both images before publishing either image. Validate their Node.js version, application SQLite native binding, startup health and restart health in CI and release workflows; publish the same validated images.

### Breaking changes and migration

No application API, metadata or database schema changes. Source installations must update Node.js to a supported patched version before installing dependencies.

### Upgrade notes

Back up the data and designer databases together. Upgrade both application and updater images to 1.4.1; replacing only the host Node.js does not update container runtimes. Source installations should use Node.js 24.22.1 and pnpm 11.25.0 and reinstall with the frozen lockfile. TLS validation is stricter upstream; integrations relying on non-canonical IP hostnames or revoked certificates may need corrected endpoints or certificates.

### Validation

Validated locally on Node.js 24.22.1 and pnpm 11.25.0: frozen-lockfile installation, version consistency, PU release policy, type checking, production build, and 348 automated tests passed (one optional legacy-backup fixture skipped). Both Linux amd64 images built successfully; runtime version, SQLite native binding, startup and restart health checks passed. The existing persistent-database upgrade check passed from 1.3.0 to 1.4.1. Both GitHub workflows passed actionlint. GitHub CI is required before merge; this release has not been published.

### Known issues

Registry publication of two images is not atomic: an upload failure can still leave only one versioned image published. Both images are built and checked before uploads begin, and latest tags are updated only after both versioned uploads succeed. Existing 1.4.0 application limitations still apply.
<!-- release-notes:end -->

## Repository structure

- `packages/core` — metadata registry, SQLite data access, schema synchronization, security, and business logic.
- `packages/server` — Fastify APIs, Web Designer services, AI proposal workflow, backup/restore, and system maintenance.
- `packages/client` — Vue web application and Web Designer.
- `docs` — developer guides for metadata features introduced by each release, starting with [localization and Data Entity extensions](docs/developer-guide.md).
- `release-notes` — release-note archive, authoring template, and maintenance guidance.

## Framework development

The repository toolchain uses Node.js 24.22.1 and pnpm 11.25.0. See [Contributing](CONTRIBUTING.md) before proposing a change. The standard verification commands are:

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
