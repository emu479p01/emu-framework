<p align="center"><img src=".github/assets/logo.svg" alt="EmuFramework" width="120"></p>

# EmuFramework

EmuFramework is a metadata-driven TypeScript framework for building business applications. It includes a browser-based Designer, generated forms and lists, role-based security, SQLite storage, reporting, import/export, and Docker deployment.

Current framework version: **0.1.6.0 (Beta)**

## v0.1.6.0 effective Menu Extension editor

- Shows inherited and current-layer menu items in one editable Design tree while saving only the current layer delta.
- Supports `visible`, target overrides, ordering, reset-to-inherited, and `parentId` anchors for extension-added items.
- Keeps Stable IDs in metadata and backups but removes them from the visual designer.
- Applies artifact visibility before privilege filtering without using visibility to grant authorization.
- Uses a responsive nested editor that wraps controls instead of overflowing its card.

`hidden` and stable-ID-path `insertions` remain readable for backward compatibility. New metadata should prefer `visible` and `parentId`:

```json
{
  "kind": "menuExtension",
  "name": "SALES_ClientCustom_SALES_MainMenu_Extension",
  "menu": "SALES_MainMenu",
  "items": [{ "id": "custom-order", "parentId": "orders", "label": "Custom order", "visible": true, "target": { "type": "form", "name": "SALES_CustomOrderForm" } }],
  "itemOverrides": [{ "targetId": "sales", "label": "Sales workspace", "visible": true, "order": 10 }]
}
```

## v0.1.5.0 responsive tables and paginated reports

- Uses the same horizontally scrollable business tables on desktop and mobile, including visible remote pagination for record lists.
- Lets Menu Extensions insert delta-only items into inherited submenus through stable-ID paths.
- Adds Tablix Detail and Line layouts with repeated column headers, field formatting, styles, and native PDF pagination.
- Unifies report Header and Footer bands with first-page, every-page, and last-page display policies while preserving v0.1.4.0 report metadata.

Menu Extensions may keep using root-level `items` and may also target inherited submenus:

```json
{
  "kind": "menuExtension",
  "name": "SALES_ClientCustom_SALES_MainMenu_Extension",
  "menu": "SALES_MainMenu",
  "items": [{ "id": "custom-root", "label": "Custom root", "target": { "type": "form", "name": "SALES_CustomForm" } }],
  "insertions": [{
    "path": ["sales", "orders"],
    "items": [{ "id": "custom-order", "label": "Custom order", "target": { "type": "form", "name": "SALES_CustomOrderForm" } }]
  }]
}
```

Report Detail and Line bands can use a Tablix; `headerRows: 1` is applied by the PDF renderer so the header repeats when the table crosses a page:

```json
{
  "kind": "detail",
  "layout": "tablix",
  "height": 18,
  "elements": [],
  "tablix": {
    "columns": [
      { "field": "accountNum", "label": "Account", "width": 100 },
      { "field": "amount", "label": "Amount", "width": 90, "align": "right", "format": "#,##0.00" }
    ],
    "headerStyle": { "bold": true, "backgroundColor": "#eeeeee", "padding": 4 },
    "rowStyle": { "padding": 4 },
    "border": { "width": 0.5, "color": "#999999" }
  }
}
```

Use `displayOn` on unified Header/Footer bands, for example `{ "kind": "header", "displayOn": "everyPage", ... }`. Legacy `pageHeader` and `pageFooter` metadata remains accepted.

## v0.1.4.0 layered customization and business UI

- Adds inherited-layer inspection and delta-only extensions for Tables, Enums, Forms, Menus, Views, Charts, Security, Scripts, and Functions.
- Migrates legacy Designer metadata with stable element IDs, canonical extension names, audit copies, and idempotent field-rule normalization.
- Makes Enum and read-only fields optional; read-only values remain writable from trusted Functions and Scripts but not from REST or generated forms.
- Adds confirmation dialogs to Form Lines and a reusable two-axis business grid with sticky headers and actions.
- Renders mixed Thai and Latin report text with grapheme-safe, glyph-aware font fallback.

## Quick start on Windows

1. Download and extract the [latest release](https://github.com/emu479p01/emu-framework/releases).
2. Double-click `RunApp.cmd`.
3. On first run, open the setup page and enter the one-time code printed by the server or Docker logs. Choose the administrator username and a password of at least 12 characters.

## v0.1.3.0 data maintenance and desktop navigation

- Framework administrators can export, replace, and permanently delete all data owned by an App under **Settings → App Data Management**. App data packages preserve record IDs and validate checksums, schema fingerprints, and cross-App references before an atomic replacement.
- **System Maintenance** can download and restore Full, Data, Designer, or Fonts backup packages. Restore validation includes checksums and SQLite integrity checks, and Windows/Docker deployments restart and roll back automatically without a manually executed restore script.
- Desktop App panels now use a one-branch accordion that remembers the last branch for the browser session. Mobile navigation is unchanged.
- Active sidebar icons retain a fixed centered position and no longer transform when selected.

## v0.1.2.0 mobile usability and package portability

- Form controls use a mobile-safe 16px input size so iPhone Safari no longer zooms the page automatically when a field receives focus, while manual pinch-to-zoom remains available.
- App and Settings icons stay centered when the desktop sidebar is collapsed.
- App and Model metadata packages up to 20 MB can be imported, allowing packages exported by the framework to be imported again after they grow beyond the previous 1 MB default.

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
