# EmuFramework Developer Guide

**Version: v0.0.0.8**

## Table of Contents
1. [Architecture Overview](#1-architecture-overview)
2. [Getting Started](#2-getting-started)
3. [Developer CLI (`pnpm emu`)](#3-developer-cli-pnpm-emu)
4. [Creating a New App](#4-creating-a-new-app)
5. [Modules](#5-modules)
6. [Tables & Fields](#6-tables--fields)
7. [Enums](#7-enums)
8. [Forms (Auto-Generated UI)](#8-forms-auto-generated-ui)
9. [Menus (Multi-Level)](#9-menus-multi-level)
10. [Business Logic: Hooks, Events, Actions](#10-business-logic-hooks-events-actions)
11. [Security: Privilege → Duty → Role](#11-security-privilege--duty--role)
12. [Extension Model](#12-extension-model)
13. [Extension Apps (`dependsOn`)](#13-extension-apps-dependson)
14. [Running the Server & Client](#14-running-the-server--client)
15. [Writing Tests](#15-writing-tests)
16. [Best Practices](#16-best-practices)
17. [Web Designer — Build & Customize Apps from the Browser](#17-web-designer--build--customize-apps-from-the-browser)
18. [Contact Pattern (Member/Publisher → Contact)](#18-contact-pattern-memberpublisher--contact)
19. [System Requirements](#19-system-requirements)
20. [AI Development Contract](#20-ai-development-contract)

---

## 1. Architecture Overview

```
Request → Fastify Server → DataContext (Security + Events + Hooks) → SQLite
                ↑                        ↑
          Metadata Registry        Kernel (Events, Hooks, Actions)
                ↑
          Apps (JSON Metadata + TypeScript Logic)
                ↑
          Vue 3 Client (Auto-generated UI from Metadata)
```

### Layers

| Layer | Package | Responsibility |
|-------|---------|--------|
| **Core** | `packages/core` | Metadata Registry, Schema Sync, Data API, Security, Events, Hooks |
| **Server** | `packages/server` | Fastify REST API, Auth, System App |
| **Client** | `packages/client` | Vue 3 auto-generated UI (ListPage, FormPage, FieldControl) |
| **CLI** | `packages/cli` | Developer tool: `pnpm emu` |
| **Apps** | `apps/*` | Business modules: your apps and their extensions |

### Metadata-Driven

Everything is driven by **JSON Metadata** — declare a Table, Form, or Menu as JSON and the UI generates itself automatically. No UI code to write.

### Extension-Only Model

An app loaded later **must never redefine** an existing object — it uses an **Extension** instead:
- `tableExtension` — adds fields/indexes to a table
- `formExtension` — adds listFields/groups to a form
- `menuExtension` — adds items to a menu

---

## 2. Getting Started

### Prerequisites

```bash
pnpm install       # install all dependencies
pnpm dev           # run server + client together (one command, cross-platform)
```

### Create a New Project

```bash
pnpm emu setup
```

### Project Structure

```
myproject/
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── apps/                    # Business apps live here
│   └── library/              # Example: Library app
│       ├── app.json          # Manifest
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/logic.ts      # Business logic (events, hooks, actions)
│       ├── metadata/         # Metadata JSON files
│       │   ├── Loans/       # Module
│       │   │   ├── tables/
│       │   │   ├── enums/
│       │   │   └── forms/
│       │   ├── menus/        # Cross-module menus
│       │   └── Security/    # Security module
│       └── test/             # Tests
└── packages/
    ├── core/                 # @emu/core
    ├── server/               # @emu/server
    └── client/               # @emu/client
    └── cli/                  # @emu/cli
```

---

## 3. Developer CLI (`pnpm emu`)

### Core Commands

```bash
pnpm emu --help                     # show all commands
pnpm emu list                       # show a tree of apps, modules, extensions
```

### Creating a New App

```bash
pnpm emu add app <name>             # interactive wizard
pnpm emu add app crm                # create a new app named crm
pnpm emu add app library.reporting  # create an extension app (dot notation)
```

The wizard asks:
- **Is this an extension?** — if yes, you must specify `dependsOn`
- **App label** — the display name
- **Depends on apps** — the base app(s)

Auto-registers in `main.ts` + `pnpm-workspace.yaml` + runs `pnpm install`

### Creating a Module

```bash
pnpm emu add module <app> <name>
pnpm emu add module library Loans       # create a Loans module in the library app
```

### Creating an Object (Table, Form, ...)

```bash
pnpm emu add object <app> <kind>
pnpm emu add object library table       # interactive wizard to create a table
pnpm emu add object library form        # interactive wizard to create a form
pnpm emu add object library menu        # interactive wizard to create a menu
```

**Supported kinds:** `table`, `enum`, `form`, `menu`, `privilege`, `duty`, `role`

The wizard asks:
- **Module** — pick the target module (if any)
- **Name, Label, Fields, …** — depends on the kind

**Non-interactive form** (for scripts/terminals without a TTY) — pass everything as flags:

```bash
pnpm emu add object library table Loans --name MyTable --label "My Table" \
  --titleField code --fields "code:string:mandatory,qty:real"
pnpm emu add object library enum Loans --name MyStatus --values "Open=0,Closed=1"
pnpm emu add object library form Loans --table MyTable
pnpm emu add object library menu --name MyMenu --items "My table=MyTableForm"
```

(The 3rd argument is the module name — omit it to place the object at the metadata root)

### Creating an Extension

```bash
pnpm emu add extension <app> <kind>
pnpm emu add extension library.fines tableExtension
pnpm emu add extension library.fines formExtension
pnpm emu add extension library.fines menuExtension
```

### What to Do After Adding or Editing an Object (Important)

This framework has **no compile/build step for metadata** — the schema syncs to SQLite automatically at server boot (only adding new tables/columns, never dropping existing ones). What you need to do next depends on what changed:

| What changed | What to do next |
|---|---|
| Metadata JSON (table/enum/form/menu/privilege/…) | **Nothing** — dev-mode server watches files under `apps/**/metadata` and restarts itself (restart manually if you're running it another way) |
| Business logic (`apps/*/src/logic.ts`) | Nothing — the server restarts automatically |
| Client code (`packages/client`) | Nothing — Vite HMR updates instantly |
| A **new app** created via `pnpm emu add app` | The CLI already registered it in `main.ts` + the workspace → restart the server once |
| Metadata edited via the **Web Designer** | Nothing at all — it takes effect immediately |
| Code in `packages/core` / `packages/server` | The server restarts automatically (dev mode) |

Good to know:
- **Removing a field from metadata** — the SQLite column is not dropped (additive-only); existing data stays, it's just no longer shown
- **Changing an existing field's type** — schema sync won't alter the column type for you; migrate manually if needed
- The browser page needs a refresh (F5) after a server restart to load the new metadata

---

## 4. Creating a New App

### app.json (Manifest)

```json
{
  "name": "crm",
  "label": "CRM System",
  "dependsOn": []
}
```

For an extension app:
```json
{
  "name": "library.reporting",
  "label": "Library Reporting Extension",
  "dependsOn": ["library"]
}
```

`dependsOn` supports multiple values:
```json
{
  "dependsOn": ["library", "library.reporting"]
}
```

### package.json

```json
{
  "name": "@emu/app-crm",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/logic.js",
  "dependencies": {
    "@emu/core": "workspace:*"
  }
}
```

An extension app must add a dependency on its base app:
```json
{
  "dependencies": {
    "@emu/core": "workspace:*",
    "@emu/app-library": "workspace:*"
  }
}
```

### Registration (Auto-Register)

When you use `pnpm emu add app`, it will:
1. Add `import { registerXxxLogic } from '@emu/app-xxx'` to `main.ts`
2. Add `join(root, 'apps', 'xxx')` to `appDirs[]`
3. Add `registerXxxLogic(kernel)` to `registerLogic()`
4. Add `apps/xxx` to `pnpm-workspace.yaml`
5. Run `pnpm install`

---

## 5. Modules

### Structure

```
apps/library/metadata/
├── Loans/                    # Module: Loans
│   ├── tables/
│   │   ├── BookLoan.json
│   │   └── BookLoanLine.json
│   ├── enums/
│   │   └── LoanStatus.json
│   └── forms/
│       └── BookLoanForm.json
├── Catalog/                  # Module: Catalog
│   ├── tables/
│   │   └── Book.json
│   └── forms/
│       └── BookForm.json
└── menus/                    # Root-level (cross-module)
    └── MainMenu.json
```

The registry auto-detects modules by scanning subdirectories under `metadata/` that **aren't** a kind directory (tables, forms, …)

### Creating a Module with the CLI

```bash
pnpm emu add module library Loans
pnpm emu add module library Catalog
```

### Creating an Object Inside a Module with the CLI

```bash
pnpm emu add object library table     # the wizard asks for a module → pick Loans
```

### Modules Don't Affect the Namespace

Every object has a name that's unique across the whole registry (a global namespace) — a module is just a way to group files, not a separate namespace.

---

## 6. Tables & Fields

### Example Table Metadata

```json
{
  "kind": "table",
  "name": "BookLoan",
  "label": "Book loans",
  "titleField": "loanId",
  "fields": [
    { "name": "loanId", "type": "string", "mandatory": true, "maxLength": 20 },
    { "name": "memberId", "type": "reference", "reference": { "table": "Member" } },
    { "name": "status", "type": "enum", "enumName": "LoanStatus", "default": 0 },
    { "name": "loanDate", "type": "date" },
    { "name": "totalFee", "type": "real", "readOnly": true }
  ],
  "indexes": [
    { "name": "LoanIdIdx", "fields": ["loanId"], "unique": true },
    { "name": "MemberIdx", "fields": ["memberId"] }
  ]
}
```

### Field Types

| Type | SQL Type | Description |
|------|----------|----------|
| `string` | TEXT | Text (`maxLength` sets the maximum length) |
| `int` | INTEGER | Integer |
| `real` | REAL | Decimal number |
| `boolean` | INTEGER (0/1) | True/false |
| `date` | TEXT | Date (ISO `yyyy-MM-dd`) |
| `datetime` | TEXT | Date and time (ISO 8601) |
| `enum` | INTEGER | A value from an Enum (`enumName` names the Enum) |
| `reference` | INTEGER | Foreign key (`reference.table`, `reference.displayField`) |

### Field Properties

| Property | Description |
|----------|----------|
| `mandatory` | Cannot be empty |
| `readOnly` | Read-only (the API rejects writes, the UI shows it but disables editing) |
| `default` | Default value |
| `maxLength` | Maximum length (`string` only) |
| `enumName` | Enum name (`enum` only) |
| `reference` | `{ table: "TargetTable", displayField?: "fieldName" }` (`reference` only) |

### Auto-Generated Columns

Every table automatically gets system columns:
- `id` — primary key (AUTOINCREMENT)
- `createdAt`, `createdBy`
- `modifiedAt`, `modifiedBy`

### Schema Sync (Additive)

Schema sync is **additive only** — `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ADD COLUMN` — it never drops or alters an existing column. Safe to run on every boot.

### Relations (Table Relationships)

A relation is declared at the **field level** with type `reference` — it stores the target record's `id` as a foreign key:

```json
{
  "name": "memberId",
  "type": "reference",
  "label": "Member",
  "mandatory": true,
  "reference": { "table": "Member" }
}
```

What the framework handles automatically:
- **Lookup dropdown** on the form — shows the value from `displayField` (falls back to the target table's `titleField` if not set)
- **List page** — shows the name instead of the id (e.g. shows "Jane Doe" instead of `1`)
- The registry **validates at boot** that the target table actually exists

You can choose which field to display:

```json
"reference": { "table": "Member", "displayField": "memberNo" }
```

**Header–Line (1:N)** — the line table has a reference back to the header, and the header's form declares a grid via `lines[].refField` (see [Line Grid](#line-grid)):

```json
// BookLoanLine.json — field pointing back to the header
{ "name": "loanId", "type": "reference", "reference": { "table": "BookLoan" } }

// BookLoanForm.json — the line grid on the header form
"lines": [
  { "table": "BookLoanLine", "refField": "loanId", "fields": ["bookId", "qty", "unitFee", "lineFee"] }
]
```

Good practice:
- Add an **index** on FK fields you query often: `"indexes": [{ "name": "LoanIdx", "fields": ["loanId"] }]`
- SQLite doesn't enforce the FK constraint for you (the framework validates at the metadata level) — if you need to prevent deleting a referenced record, write a `validateDelete` hook to check it yourself, e.g. don't allow deleting a Member who has open loans

---

## 7. Enums

```json
{
  "kind": "enum",
  "name": "LoanStatus",
  "label": "Loan status",
  "values": [
    { "name": "Open", "value": 0, "label": "Open" },
    { "name": "CheckedOut", "value": 1, "label": "Checked out" },
    { "name": "Cancelled", "value": 2, "label": "Cancelled" }
  ]
}
```

In TypeScript:
```ts
export const LoanStatus = { Open: 0, CheckedOut: 1, Cancelled: 2 } as const;
```

---

## 8. Forms (Auto-Generated UI)

The framework generates a **List Page** + **Detail Form** automatically from Form Metadata

### Example Form

```json
{
  "kind": "form",
  "name": "BookLoanForm",
  "label": "Book loans",
  "table": "BookLoan",
  "listFields": ["loanId", "memberId", "status", "loanDate", "totalFee"],
  "groups": [
    { "label": "Header", "fields": ["loanId", "memberId", "status"] },
    { "label": "Details", "fields": ["loanDate", "totalFee"] }
  ],
  "actions": [
    { "label": "Check out", "action": "BookLoanCheckout" }
  ],
  "lines": [
    {
      "table": "BookLoanLine",
      "refField": "loanId",
      "fields": ["bookId", "qty", "unitFee", "lineFee"]
    }
  ]
}
```

### Form Components

| Property | Description |
|----------|----------|
| `table` | The table this form is backed by |
| `listFields` | Columns on the List Page (default: every field) |
| `groups` | Tabs/groups on the Detail Form |
| `actions` | Action buttons (call a server-side action) |
| `lines` | Line grid (child table) — inline editable |

### Line Grid

```json
{
  "table": "BookLoanLine",
  "refField": "loanId",
  "fields": ["bookId", "qty", "unitFee", "lineFee"]
}
```

- `table` — the child table
- `refField` — the foreign key field on the child that points at the parent's id
- `fields` — columns shown in the grid

---

## 9. Menus (Multi-Level)

### Flat Menu (single level)

```json
{
  "kind": "menu",
  "name": "MainMenu",
  "label": "My Library",
  "items": [
    { "label": "Members", "form": "MemberForm" }
  ]
}
```

### Multi-Level Menu (Module Groups)

```json
{
  "kind": "menu",
  "name": "MainMenu",
  "label": "My Library",
  "items": [
    {
      "label": "Loans",
      "items": [
        { "label": "Book loans", "form": "BookLoanForm" }
      ]
    },
    {
      "label": "Catalog",
      "items": [
        { "label": "Books", "form": "BookForm" }
      ]
    },
    { "label": "Members", "form": "MemberForm" }
  ]
}
```

Nesting is supported to **unlimited depth** — submenus can go as deep as you like.

### Security Filtering

Menu items whose form the user can't access are filtered out automatically (users never see a button they can't use).

---

## 10. Business Logic: Hooks, Events, Actions

All business logic is written in `apps/<app>/src/logic.ts` — export `registerXxxLogic(kernel)`

```ts
import type { Kernel } from '@emu/core';
import { ValidationError } from '@emu/core';

export function registerLibraryLogic(kernel: Kernel): void {
  // Hooks, Events, Actions ...
}
```

### 10.1 Table Hooks (validateWrite, validateDelete, initValue)

Hooks are **table lifecycle methods** — they run before/during a write or delete

```ts
kernel.hooks.register('BookLoan', {
  validateDelete(rec) {
    // prevent deleting a loan that's already checked out
    if (rec.f.status === LoanStatus.CheckedOut) {
      throw new ValidationError('Cannot delete a checked-out loan');
    }
  },
  validateWrite(rec, ctx) {
    // validate before save
  },
  initValue(rec, ctx) {
    // set default values on a new record
  },
});
```

### 10.2 Data Events (Pre/Post)

Events are **event handlers** — subscribe before/after insert/update/delete

```ts
// Pre-events: can cancel the operation
kernel.events.on('BookLoanLine', 'onInserting', (e) => {
  // auto-compute lineFee before insert
  e.record.f.lineFee =
    (e.record.f.qty as number) * (e.record.f.unitFee as number);
});

// Post-events: notify after success
kernel.events.on('BookLoanLine', 'onInserted', (e) => {
  // update the header total
  updateHeaderTotal(e.ctx, e.record.f.loanId as number);
});

// Cancel with e.cancel(message)
kernel.events.on('BookLoan', 'onUpdating', (e) => {
  if (condition) e.cancel('reason for cancelling');
});
```

**Event types:** `onValidating`, `onInserting`, `onInserted`, `onUpdating`, `onUpdated`, `onDeleting`, `onDeleted`

### 10.3 Actions (Server-Side Operations)

Actions are **named server operations** — called from a Form or the API

```ts
kernel.actions.set('BookLoanCheckout', (ctx, args) => {
  const id = Number(args.id);
  return ctx.tts(() => {        // tts = transaction
    const loan = ctx.find('BookLoan', id);
    if (!loan) throw new ValidationError('Loan not found');

    // validate + process
    const lines = ctx.select('BookLoanLine').whereEq({ loanId: id }).toArray();
    for (const line of lines) {
      const book = ctx.find('Book', line.f.bookId as number);
      book.f.availableCopies = (book.f.availableCopies as number) - (line.f.qty as number);
      book.update();
    }

    loan.f.status = LoanStatus.CheckedOut;
    loan.update();
    return { ok: true };
  });
});
```

Called from a Form:
```json
{ "actions": [{ "label": "Check out", "action": "BookLoanCheckout" }] }
```

Called from the API:
```
POST /api/action/BookLoanCheckout
{ "id": 123 }
```

### 10.4 DataContext API

```ts
// Create
const rec = ctx.newRecord('Member');
rec.f.memberNo = 'M-001';
rec.f.name = 'Jane Doe';
rec.setMany({ phone: '...', email: '...' });
rec.insert();    // returns the same record with id set

// Read
const member = ctx.find('Member', 1);
const list = ctx.select('Member')
  .whereEq({ memberNo: 'M-001' })
  .orderBy('name', 'asc')
  .limit(10, 0)
  .toArray();
const first = ctx.select('Member').where('id', '>', 10).firstOnly();

// Update
const rec = ctx.find('Member', 1);
rec.f.name = 'New Name';
rec.update();

// Delete
rec.delete();

// Transaction (tts = ttsbegin/ttscommit)
ctx.tts(() => {
  // multiple operations — atomic rollback on error
});
```

### 10.5 Extension App Events

An extension app can subscribe to a base app's events without touching the base code:

```ts
// library.fines/src/logic.ts
kernel.events.on('BookLoan', 'onUpdating', (e) => {
  // outstanding-fines check — cancel checkout if fines are too high
  if (e.record.f.status !== LoanStatus.CheckedOut) return;
  const member = e.ctx.find('Member', e.record.f.memberId as number);
  if (finesTooHigh) e.cancel('Outstanding fines too high');
});
```

---

## 11. Security: Privilege → Duty → Role

Enterprise-style security model: **Role → Duty → Privilege**

### 11.1 Privilege — Table/Form-Level Permissions

```json
{
  "kind": "privilege",
  "name": "LoanProcess",
  "label": "Process book loans",
  "tablePermissions": [
    { "table": "BookLoan", "read": true, "create": true, "update": true, "delete": true },
    { "table": "BookLoanLine", "read": true, "create": true, "update": true, "delete": true },
    { "table": "Member", "read": true },
    { "table": "Book", "read": true, "update": true }
  ],
  "forms": ["BookLoanForm"]
}
```

### 11.2 Duty — a Group of Privileges

```json
{
  "kind": "duty",
  "name": "LoanProcessing",
  "label": "Loan processing",
  "privileges": ["LoanProcess"]
}
```

### 11.3 Role — a Group of Duties + Privileges

```json
{
  "kind": "role",
  "name": "LibraryManager",
  "label": "Library manager",
  "duties": ["LoanProcessing", "MasterDataMaintenance"]
}
```

Direct privileges (bypassing duties):
```json
{
  "kind": "role",
  "name": "ReadOnlyUser",
  "duties": [],
  "privileges": ["SomeReadOnlyPrivilege"]
}
```

### 11.4 Assigning a Role to a User

Through the `FW_UserRole` table (managed from the Users page in the UI):

```
Users → select a user → Roles grid → add a role
```

### 11.5 Admin Bypass

The hard-coded admin (`admin/admin`) has an `allowAll` policy — access to every table and form

### 11.6 SystemAdminRole

```json
{
  "kind": "role",
  "name": "SystemAdminRole",
  "duties": ["SystemAdminDuty"]
}
```

Can be assigned to a regular user to grant user/role management rights

---

## 12. Extension Model

### 12.1 Table Extension — Add a Field to a Table

```json
{
  "kind": "tableExtension",
  "name": "Member.FinesExt",
  "table": "Member",
  "fields": [
    { "name": "outstandingFines", "type": "real" }
  ],
  "indexes": [
    { "name": "FinesIdx", "fields": ["outstandingFines"] }
  ]
}
```

**Rule:** must not duplicate a field that already exists.

### 12.2 Form Extension — Add a Field/Group to a Form

```json
{
  "kind": "formExtension",
  "name": "MemberForm.FinesExt",
  "form": "MemberForm",
  "listFields": ["outstandingFines"],
  "groups": [
    { "label": "Fines", "fields": ["outstandingFines"] }
  ]
}
```

### 12.3 Menu Extension — Add an Item to a Menu

```json
{
  "kind": "menuExtension",
  "name": "MainMenu.ReportingExt",
  "menu": "MainMenu",
  "items": [
    { "label": "Reports", "form": "ReportForm" }
  ]
}
```

### Good to Know

- An extension **appends** to the base artifact — it never overwrites it
- Extension names must be unique system-wide
- `structuredClone` is used to prevent mutating the caller's object
- Extension metadata lives under `apps/<app>/metadata/<kind>Extensions/`
- Both root-level and module-level extensions are supported

---

## 13. Extension Apps (`dependsOn`)

An extension app is an app that adds features to a base app without touching the base app's code.

### Naming Convention (Dot Notation)

```
library              # Base app
library.reporting    # Extension: Reporting
library.fines        # Extension: Outstanding fines
```

### Creating One

```bash
pnpm emu add app library.integration   # wizard → "Is this an extension?" → Yes → dependsOn: [library]
```

### Extension App Structure

```
apps/library.fines/
├── app.json           # { "name": "library.fines", "dependsOn": ["library"] }
├── package.json       # depends on "@emu/app-library": "workspace:*"
├── src/logic.ts       # subscriber events, added hooks
└── metadata/
    ├── tableExtensions/
    └── formExtensions/
```

### Multiple `dependsOn`

A single extension can extend more than one base:

```json
{
  "name": "library.advanced",
  "dependsOn": ["library", "library.reporting"]
}
```

---

## 14. Running the Server & Client

### Development

```bash
pnpm dev                          # run server + client together (one command, cross-platform)

# or run them separately (two terminal windows):
pnpm --filter @emu/server dev     # start the API server (port 3399)
pnpm --filter @emu/client dev     # start the Vite dev server (port 5199)
```

Or use the helper script:
```bash
start.cmd          # Windows — opens server + client
```

### Login

| User | Password | Roles |
|------|----------|-------|
| `admin` | `admin` | Framework administrator (seeded automatically, full access) |

### API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/login` | Log in |
| `POST` | `/api/logout` | Log out |
| `GET` | `/api/me` | Current user info + roles |
| `GET` | `/api/metadata` | All metadata (filtered by security) |
| `GET` | `/api/data/:table` | List records (filter, sort, pagination) |
| `GET` | `/api/data/:table/:id` | Get one record |
| `POST` | `/api/data/:table` | Create a record |
| `PATCH` | `/api/data/:table/:id` | Update a record |
| `DELETE` | `/api/data/:table/:id` | Delete a record |
| `POST` | `/api/action/:name` | Execute a server action |

---

## 15. Writing Tests

Uses **Vitest** (the framework's test runner)

### Example Test

```ts
import { describe, it, expect } from 'vitest';
import { Kernel } from '@emu/core';
import { registerMyAppLogic } from '../src/logic.js';

describe('MyApp business logic', () => {
  function setup() {
    const kernel = new Kernel(':memory:');
    registerSystemApp(kernel);           // if you need system tables
    kernel.loadAppFromDir('apps/myapp'); // load metadata
    kernel.sync();
    registerMyAppLogic(kernel);          // register logic
    return { kernel, ctx: kernel.context() };
  }

  it('should create a record', () => {
    const { ctx } = setup();
    const rec = ctx.newRecord('MyTable');
    rec.setMany({ name: 'Test' });
    rec.insert();
    expect(rec.id).toBe(1);
  });
});
```

### Running Tests

```bash
pnpm -r test                            # run every test suite
pnpm --filter @emu/app-library test      # run the library app's tests
```

---

## 16. Best Practices

### 16.1 Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| App (base) | lowercase | `library`, `crm` |
| App (extension) | `<base>.<feature>` | `library.fines`, `library.reporting` |
| Table | PascalCase | `BookLoan`, `Member` |
| Form | `<Table>Form` | `BookLoanForm` |
| Menu | PascalCase | `MainMenu` |
| Enum | PascalCase | `LoanStatus` |
| Privilege | PascalCase | `LoanProcess` |
| Duty | PascalCase | `LoanProcessing` |
| Role | PascalCase | `LibraryManager` |
| Module (dir) | PascalCase | `Loans`, `Catalog` |
| Extension (name) | `<Base>.<Name>` | `Member.FinesExt` |

### 16.2 Metadata Organization

```
apps/<app>/metadata/
├── <Module>/           # grouped by module
│   ├── tables/
│   ├── enums/
│   ├── forms/
│   └── ...
├── menus/              # menus that cross modules
└── <Extension dirs>/   # extensions
```

### 16.3 Business Logic

- **Hooks** → use for validation + init values (table-level logic)
- **Events** → use for side effects + cross-table updates
- **Actions** → use for complex transactions called from the UI
- **Extension logic** → subscribe to the base app's events instead of touching its code

### 16.4 Security

- Define a Privilege every time you create a new Table/Form
- Group Privileges into a Duty
- Group Duties into a Role
- Assign a Role to a User through `FW_UserRole`

### 16.5 Transactions (tts)

Use `ctx.tts()` for operations that need an atomic rollback:

```ts
ctx.tts(() => {
  loan.f.status = LoanStatus.CheckedOut;
  loan.update();
  // if an error happens in here — everything rolls back
  for (const line of lines) {
    book.update();
  }
});
```

### 16.6 Extension App Workflow

1. Create the extension app: `pnpm emu add app library.myext`
2. Add extension metadata: `pnpm emu add extension library.myext tableExtension`
3. Write logic: subscribe to the base app's events
4. Register in `main.ts` (auto-registered)

### 16.7 Things to Watch Out For

- **Never edit base metadata directly** — use an extension instead
- **Schema sync is additive** — drop the DB yourself if you need to recreate it
- **Extension names must be unique** — no clashing with another extension
- **`dependsOn` order matters** — base apps must load before their extensions
- **`SystemUser`, `SystemSession` are protected** — never exposed through the generic data API

---

## 17. Web Designer — Build & Customize Apps from the Browser

The Web Designer is an in-browser tool that lets an admin create/edit metadata in real time,
with no server restart. Everything is stored in the `FW_WebArtifact` table and applied
immediately. This section is deliberately brief — see
[docs/WEB-DESIGNER-GUIDE.md](./WEB-DESIGNER-GUIDE.md) for the full no-code walkthrough
(creating apps, tables, forms, menus, extensions, and its current limitations), written for
non-developers.

Quick reference: log in as `admin` (or a user with `FW_FrameworkUser`/`FW_SystemAdminRole`) →
**Development → Designer** menu → **New…** to create an app/table/form/menu/enum, or click an
existing table under **Customize existing tables** to extend it. Everything applies live via
`kernel.applyWebArtifacts()`; schema sync stays additive-only (deleting an artifact never drops
the underlying column/table).

---

## 18. Contact Pattern (Member/Publisher → Contact)

Every **Member** and **Publisher** always has a linked record in **Contact** (module `Contacts` of the `library` app) — the name and type (Organization/Person) live centrally on the contact.

### Automatic Behavior (from `registerContactLogic` in apps/library/src/logic.ts)

- **Creating** a Member/Publisher → the framework creates a Contact record (named after the Member/Publisher, type = Organization) and sets `contactId`
- **Renaming** a Member/Publisher → the linked contact's name updates to match
- **Deleting** a Member/Publisher → the contact record is deleted too
- If a record is inserted with **`contactId` supplied explicitly** (e.g. during a data import) → no duplicate contact is created

### Structure

```
Contact (Contacts/tables/)         ← name, contactType
   ↑ contactId (reference, readOnly)
Member (Members/tables/)   Publisher (Publishers/tables/)
```

See the full contact list from the **Members → All contacts** menu (form `ContactForm`)

---

## 19. System Requirements

EmuFramework runs as a **single Node.js process** with an **embedded SQLite database** (no separate DB server).
The main costs are CPU for the Fastify/Node event loop and RAM for the Node heap + SQLite page cache.

| Usage level | CPU | RAM | Disk |
|---|---|---|---|
| Dev / Test / Demo | 1 vCPU | 512MB–1GB | 1GB+ |
| Small production (<20 concurrent) | 1–2 vCPU | 2GB | 10–20GB SSD, persistent |
| Medium production (20–100 concurrent) | 2–4 vCPU | 4–8GB | 40GB+ SSD, persistent |
| Large scale (>100 concurrent) | Migrate to a managed DB (Postgres) before scaling further | — | — |

Requirements that always apply, regardless of scale:

- **Long-running process** — no serverless/request-per-invocation hosting, since SQLite keeps its state as files on disk
- **Persistent disk/volume** that survives redeploys — `data.db` and `designer.db` are all of the system's data

For the full list of supported hosting plans (VPS, Railway, Render, Fly.io) with the environment variables table,
see [README.md — Deployment](../README.md#deployment)

## 20. AI Development Contract

Use `pnpm emu inspect --json` and `pnpm emu schema --json` to give an AI a bounded,
machine-readable view of a workspace. AI-authored work is represented as a revisioned
`MetadataChangeSet` and checked with `pnpm emu validate <file> --json` without changing files,
databases, or the runtime registry. A developer must review and confirm `pnpm emu apply <file>`.

The optional local `@emu/mcp` package exposes the same inspect and validation contract over
stdio. It intentionally has no apply, delete, SQL, business-record, or script-execution tools.
See [AI-DEVELOPER-GUIDE.md](AI-DEVELOPER-GUIDE.md) for schemas, examples, and setup.
