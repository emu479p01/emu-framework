# Understand the architecture

EmuFramework is a pnpm workspace with four runtime layers: core metadata/database services, Fastify API, Vue client, and app metadata. The CLI scaffolds metadata; the MCP package exposes development context to AI tools.

The kernel loads code metadata, synchronizes additive SQLite schema changes, loads Designer artifacts, registers business logic, and enforces security. `data.db` stores business and system records; `designer.db` stores browser-created artifacts.

Apps extend the framework through metadata, hooks, events, and declared dependencies. Avoid editing generated database structure manually.

## Related topics

[Metadata](metadata.md) · [Business logic](business-logic.md) · [Extensions](extensions.md)
