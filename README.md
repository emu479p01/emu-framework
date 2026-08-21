# EmuFramework v0.5.0.0

## Release notes

- Supports 5,000+ metadata artifacts through a single-pass registry fast path, affected-table schema synchronization, indexed Designer metadata, and SQLite WAL lock tuning.
- Adds effective Form Extension Line editing with delta-only `lineOverrides` for inherited fields, aggregates, actions, labels, visibility, and order.
- Replaces the AI MCP package with scoped REST APIs for inspection, validation, and human-approved metadata proposals, including executable artifacts and audit history.
- Runs in production through Docker only. Host launch/install/update scripts and the user CLI have been removed.
- Keeps SQLite as the only database, preserving `data.db`, `designer.db`, synchronous DataContext behavior, and compatible 0.1.x metadata.
- Adds SQLite health diagnostics, checksummed backups, Docker-sidecar update/restore, AI token administration, and an AI Proposal Inbox in Web Designer.
