# คู่มือ Developer — EmuFramework

**เวอร์ชัน: v0.0.0.5**

## สารบัญ
1. [ภาพรวม Architecture](#1-ภาพรวม-architecture)
2. [เริ่มต้นใช้งาน](#2-เริ่มต้นใช้งาน)
3. [Developer CLI (`pnpm emu`)](#3-developer-cli-pnpm-emu)
4. [การสร้าง App ใหม่](#4-การสร้าง-app-ใหม่)
5. [โมดูล (Module)](#5-โมดูล-module)
6. [Table & Fields](#6-table--fields)
7. [Enum](#7-enum)
8. [Form (หน้าจอ UI อัตโนมัติ)](#8-form-หน้าจอ-ui-อัตโนมัติ)
9. [Menu (เมนูหลายระดับ)](#9-menu-เมนูหลายระดับ)
10. [Business Logic: Hooks, Events, Actions](#10-business-logic-hooks-events-actions)
11. [Security: Privilege → Duty → Role](#11-security-privilege--duty--role)
12. [Extension Model](#12-extension-model)
13. [Extension App (`dependsOn`)](#13-extension-app-dependson)
14. [การ Run Server & Client](#14-การ-run-server--client)
15. [การเขียน Test](#15-การเขียน-test)
16. [Best Practices](#16-best-practices)
17. [Web Designer — สร้าง App และ Customize จาก Browser](#17-web-designer--สร้าง-app-และ-customize-จาก-browser)
18. [DirParty Pattern (Customer/Vendor → Party)](#18-dirparty-pattern-customervendor--party)
19. [System Requirements / ข้อกำหนดระบบ](#19-system-requirements--ข้อกำหนดระบบ)

---

## 1. ภาพรวม Architecture

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

| Layer | Package | หน้าที่ |
|-------|---------|--------|
| **Core** | `packages/core` | Metadata Registry, Schema Sync, Data API, Security, Events, Hooks |
| **Server** | `packages/server` | Fastify REST API, Auth, System App |
| **Client** | `packages/client` | Vue 3 Auto-generated UI (ListPage, FormPage, FieldControl) |
| **CLI** | `packages/cli` | Developer Tool: `pnpm emu` |
| **Apps** | `apps/*` | Business Modules: ERP, CRM, Extensions |

### Metadata-Driven

ทุกอย่างขับเคลื่อนด้วย **JSON Metadata** — ประกาศ Table, Form, Menu เป็น JSON แล้ว UI จะ Generate อัตโนมัติ ไม่ต้องเขียน UI เอง

### Extension-Only Model

App ที่โหลดทีหลัง **ห้าม redefine** object เดิม — ใช้ **Extension** แทน:
- `tableExtension` — เพิ่ม field/index ให้ table
- `formExtension` — เพิ่ม listFields/groups ให้ form
- `menuExtension` — เพิ่ม items ให้ menu

---

## 2. เริ่มต้นใช้งาน

### Prerequisites

```bash
pnpm install       # ติดตั้ง dependencies ทั้งหมด
pnpm dev           # รัน server + client พร้อมกัน (คำสั่งเดียว, ข้าม OS ได้)
```

### สร้าง Project ใหม่

```bash
pnpm emu setup
```

### โครงสร้าง Project

```
myproject/
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── apps/                    # Business apps อยู่ที่นี่
│   └── erp/                 # ตัวอย่าง: ERP Standard
│       ├── app.json          # Manifest
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/logic.ts      # Business logic (events, hooks, actions)
│       ├── metadata/         # Metadata JSON files
│       │   ├── Sales/       # Module
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

### คำสั่ง Core

```bash
pnpm emu --help                     # ดูคำสั่งทั้งหมด
pnpm emu list                       # ดู tree ของ apps, modules, extensions
```

### สร้าง App ใหม่

```bash
pnpm emu add app <name>             # interactive wizard
pnpm emu add app crm                # สร้าง app ใหม่ชื่อ crm
pnpm emu add app erp.reporting      # สร้าง extension app (dot notation)
```

ใน wizard จะถาม:
- **Is this an extension?** — ถ้าใช่ ต้องระบุ `dependsOn`
- **App label** — ชื่อแสดงผล
- **Depends on apps** — ระบุ base app(s)

Auto-register ใน `main.ts` + `pnpm-workspace.yaml` + run `pnpm install`

### สร้าง Module

```bash
pnpm emu add module <app> <name>
pnpm emu add module erp Sales       # สร้าง module Sales ใน app erp
```

### สร้าง Object (Table, Form, ...)

```bash
pnpm emu add object <app> <kind>
pnpm emu add object erp table       # interactive wizard สร้าง table
pnpm emu add object erp form        # interactive wizard สร้าง form
pnpm emu add object erp menu        # interactive wizard สร้าง menu
```

**Kinds ที่รองรับ:** `table`, `enum`, `form`, `menu`, `privilege`, `duty`, `role`

ใน wizard จะถาม:
- **Module** — เลือก module ที่ต้องการ (ถ้ามี)
- **Name, Label, Fields, …** — ตามแต่ละ kind

**แบบไม่ต้องตอบ wizard** (เหมาะกับ script/terminal ที่ไม่มี TTY) — ระบุทุกอย่างเป็น flag:

```bash
pnpm emu add object erp table Sales --name MyTable --label "My Table" \
  --titleField code --fields "code:string:mandatory,qty:real"
pnpm emu add object erp enum Sales --name MyStatus --values "Open=0,Closed=1"
pnpm emu add object erp form Sales --table MyTable
pnpm emu add object erp menu --name MyMenu --items "My table=MyTableForm"
```

(อาร์กิวเมนต์ตัวที่ 3 คือชื่อ module — ไม่ใส่ = วางที่ root ของ metadata)

### สร้าง Extension

```bash
pnpm emu add extension <app> <kind>
pnpm emu add extension erp.credit tableExtension
pnpm emu add extension erp.credit formExtension
pnpm emu add extension erp.credit menuExtension
```

### ทำอะไรต่อ หลังเพิ่มหรือแก้ไข Object (สำคัญ)

Framework นี้**ไม่มีขั้นตอน compile/build สำหรับ metadata** — schema จะ sync กับ SQLite อัตโนมัติตอน server boot (เพิ่ม table/column ใหม่ให้เท่านั้น ไม่ลบของเดิม) สิ่งที่ต้องทำต่อขึ้นกับว่าแก้อะไร:

| แก้อะไร | ต้องทำอะไรต่อ |
|---|---|
| metadata JSON (table/enum/form/menu/privilege/…) | **ไม่ต้องทำอะไร** — server dev mode ตรวจจับไฟล์ใน `apps/**/metadata` แล้ว restart ให้เอง (ถ้ารันแบบอื่นให้ restart server เอง) |
| business logic (`apps/*/src/logic.ts`) | ไม่ต้องทำอะไร — server restart อัตโนมัติ |
| โค้ด client (`packages/client`) | ไม่ต้องทำอะไร — Vite HMR อัปเดตทันที |
| สร้าง **app ใหม่** ผ่าน `pnpm emu add app` | CLI ลงทะเบียนใน `main.ts` + workspace ให้แล้ว → restart server หนึ่งครั้ง |
| แก้ metadata ผ่าน **Web Designer** | ไม่ต้องทำอะไรเลย — มีผลทันทีในระบบ |
| แก้โค้ด `packages/core` / `packages/server` | server restart อัตโนมัติ (dev mode) |

ข้อควรรู้:
- **ลบ field ออกจาก metadata** — column ใน SQLite จะไม่ถูกลบ (additive-only) ข้อมูลเดิมยังอยู่ แค่ไม่แสดง
- **เปลี่ยน type ของ field เดิม** — schema sync จะไม่แก้ column type ให้ ถ้าจำเป็นต้อง migrate เอง
- หน้าเว็บต้อง refresh (F5) หลัง server restart เพื่อโหลด metadata ชุดใหม่

---

## 4. การสร้าง App ใหม่

### app.json (Manifest)

```json
{
  "name": "crm",
  "label": "CRM System",
  "dependsOn": []
}
```

สำหรับ Extension App:
```json
{
  "name": "erp.reporting",
  "label": "ERP Reporting Extension",
  "dependsOn": ["erp"]
}
```

`dependsOn` รองรับหลายค่า:
```json
{
  "dependsOn": ["erp", "erp.reporting"]
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

Extension App ต้องเพิ่ม dependency ไปยัง base app:
```json
{
  "dependencies": {
    "@emu/core": "workspace:*",
    "@emu/app-erp": "workspace:*"
  }
}
```

### การลงทะเบียน (Auto-Register)

เมื่อใช้ `pnpm emu add app` — ระบบจะ:
1. เพิ่ม `import { registerXxxLogic } from '@emu/app-xxx'` ใน `main.ts`
2. เพิ่ม `join(root, 'apps', 'xxx')` ใน `appDirs[]`
3. เพิ่ม `registerXxxLogic(kernel)` ใน `registerLogic()`
4. เพิ่ม `apps/xxx` ใน `pnpm-workspace.yaml`
5. รัน `pnpm install`

---

## 5. โมดูล (Module)

### โครงสร้าง

```
apps/erp/metadata/
├── Sales/                    # Module: Sales
│   ├── tables/
│   │   ├── SalesTable.json
│   │   └── SalesLine.json
│   ├── enums/
│   │   └── SalesStatus.json
│   └── forms/
│       └── SalesTableForm.json
├── Inventory/                # Module: Inventory
│   ├── tables/
│   │   └── InventItem.json
│   └── forms/
│       └── InventItemForm.json
└── menus/                    # Root-level (cross-module)
    └── MainMenu.json
```

Registry จะ auto-detect modules โดย scan subdirectories ภายใต้ `metadata/` ที่**ไม่ใช่** kind directory (tables, forms, …)

### สร้าง Module ด้วย CLI

```bash
pnpm emu add module erp Sales
pnpm emu add module erp Inventory
```

### สร้าง Object ใน Module ด้วย CLI

```bash
pnpm emu add object erp table     # wizard จะถาม module → เลือก Sales
```

### Module ไม่มีผลต่อ Namespace

Object ทุกตัวมีชื่อไม่ซ้ำกันทั่วทั้ง Registry (global namespace) — Module เป็นแค่การจัดกลุ่มไฟล์ ไม่ใช่ namespace แยก

---

## 6. Table & Fields

### ตัวอย่าง Table Metadata

```json
{
  "kind": "table",
  "name": "SalesTable",
  "label": "Sales orders",
  "titleField": "salesId",
  "fields": [
    { "name": "salesId", "type": "string", "mandatory": true, "maxLength": 20 },
    { "name": "custId", "type": "reference", "reference": { "table": "CustTable" } },
    { "name": "status", "type": "enum", "enumName": "SalesStatus", "default": 0 },
    { "name": "orderDate", "type": "date" },
    { "name": "totalAmount", "type": "real", "readOnly": true }
  ],
  "indexes": [
    { "name": "SalesIdIdx", "fields": ["salesId"], "unique": true },
    { "name": "CustIdx", "fields": ["custId"] }
  ]
}
```

### Field Types

| Type | SQL Type | คำอธิบาย |
|------|----------|----------|
| `string` | TEXT | ข้อความ (`maxLength` กำหนดความยาวสูงสุด) |
| `int` | INTEGER | จำนวนเต็ม |
| `real` | REAL | ทศนิยม |
| `boolean` | INTEGER (0/1) | ค่าจริง/เท็จ |
| `date` | TEXT | วันที่ (ISO `yyyy-MM-dd`) |
| `datetime` | TEXT | วันเวลา (ISO 8601) |
| `enum` | INTEGER | ค่าจาก Enum (`enumName` ระบุชื่อ Enum) |
| `reference` | INTEGER | Foreign Key (`reference.table`, `reference.displayField`) |

### Field Properties

| Property | คำอธิบาย |
|----------|----------|
| `mandatory` | ห้ามว่าง |
| `readOnly` | อ่านอย่างเดียว (API ไม่รับเขียน, UI แสดงแต่แก้ไม่ได้) |
| `default` | ค่าเริ่มต้น |
| `maxLength` | ความยาวสูงสุด (เฉพาะ `string`) |
| `enumName` | ชื่อ Enum (เฉพาะ `enum`) |
| `reference` | `{ table: "TargetTable", displayField?: "fieldName" }` (เฉพาะ `reference`) |

### Auto-Generated Columns

ทุก Table มี system columns อัตโนมัติ:
- `id` — Primary Key (AUTOINCREMENT)
- `createdAt`, `createdBy`
- `modifiedAt`, `modifiedBy`

### Schema Sync (Additive)

Schema Sync เป็น **additive** เท่านั้น — `CREATE TABLE IF NOT EXISTS` และ `ALTER TABLE ADD COLUMN` — ไม่เคย DROP หรือ ALTER column เดิม ปลอดภัยที่จะรันทุกครั้งที่ boot

### Relations (ความสัมพันธ์ระหว่าง Table)

Relation กำหนดที่**ระดับ field** ด้วย type `reference` — เก็บค่าเป็น `id` ของ record ปลายทาง (FK):

```json
{
  "name": "custId",
  "type": "reference",
  "label": "Customer",
  "mandatory": true,
  "reference": { "table": "CustTable" }
}
```

สิ่งที่ framework จัดการให้อัตโนมัติ:
- **Lookup dropdown** บน form — แสดงค่าจาก `displayField` (ถ้าไม่ระบุ ใช้ `titleField` ของ table ปลายทาง)
- **List page** — แสดงชื่อแทน id (เช่นแสดง "Contoso" แทน `1`)
- Registry **validate ตอน boot** ว่า table ปลายทางมีจริง

ระบุ field ที่ใช้แสดงเองได้:

```json
"reference": { "table": "CustTable", "displayField": "accountNum" }
```

**Header–Line (1:N)** — ตาราง line มี reference กลับไปหา header แล้วประกาศ grid ใน form ของ header ผ่าน `lines[].refField` (ดู [Line Grid](#line-grid)):

```json
// SalesLine.json — field ชี้กลับ header
{ "name": "salesId", "type": "reference", "reference": { "table": "SalesTable" } }

// SalesTableForm.json — grid ของ line บน form header
"lines": [
  { "table": "SalesLine", "refField": "salesId", "fields": ["itemId", "qty", "salesPrice", "lineAmount"] }
]
```

แนวปฏิบัติ:
- ใส่ **index** บน FK field ที่ query บ่อย: `"indexes": [{ "name": "SalesIdx", "fields": ["salesId"] }]`
- SQLite ไม่ enforce FK constraint ให้ (framework validate ระดับ metadata) — ถ้าต้องการกันลบ record ที่ถูกอ้างถึง ให้เขียน hook `validateDelete` เช็คเอง เช่นห้ามลบ Customer ที่มี Sales order ค้างอยู่

---

## 7. Enum

```json
{
  "kind": "enum",
  "name": "SalesStatus",
  "label": "Sales order status",
  "values": [
    { "name": "Open", "value": 0, "label": "Open" },
    { "name": "Posted", "value": 1, "label": "Posted" },
    { "name": "Cancelled", "value": 2, "label": "Cancelled" }
  ]
}
```

ใน TypeScript:
```ts
export const SalesStatus = { Open: 0, Posted: 1, Cancelled: 2 } as const;
```

---

## 8. Form (หน้าจอ UI อัตโนมัติ)

Framework generate **List Page** + **Detail Form** อัตโนมัติจาก Form Metadata

### ตัวอย่าง Form

```json
{
  "kind": "form",
  "name": "SalesTableForm",
  "label": "Sales orders",
  "table": "SalesTable",
  "listFields": ["salesId", "custId", "status", "orderDate", "totalAmount"],
  "groups": [
    { "label": "Header", "fields": ["salesId", "custId", "status"] },
    { "label": "Details", "fields": ["orderDate", "totalAmount"] }
  ],
  "actions": [
    { "label": "Post", "action": "SalesOrderPost" }
  ],
  "lines": [
    {
      "table": "SalesLine",
      "refField": "salesId",
      "fields": ["itemId", "qty", "salesPrice", "lineAmount"]
    }
  ]
}
```

### Form Components

| Property | คำอธิบาย |
|----------|----------|
| `table` | Table ที่ form นี้ใช้ |
| `listFields` | Columns ใน List Page (default: ทุก field) |
| `groups` | Tab/Group ใน Detail Form |
| `actions` | ปุ่ม Action (เรียก server-side action) |
| `lines` | Line Grid (child table) — inline editable |

### Line Grid

```json
{
  "table": "SalesLine",
  "refField": "salesId",
  "fields": ["itemId", "qty", "salesPrice", "lineAmount"]
}
```

- `table` — child table
- `refField` — foreign key field บน child ที่อ้างถึง id ของ parent
- `fields` — columns ใน grid

---

## 9. Menu (เมนูหลายระดับ)

### Flat Menu (ระดับเดียว)

```json
{
  "kind": "menu",
  "name": "MainMenu",
  "label": "Mini ERP",
  "items": [
    { "label": "Customers", "form": "CustTableForm" }
  ]
}
```

### Multi-Level Menu (Module Groups)

```json
{
  "kind": "menu",
  "name": "MainMenu",
  "label": "Mini ERP",
  "items": [
    {
      "label": "Sales",
      "items": [
        { "label": "Sales orders", "form": "SalesTableForm" }
      ]
    },
    {
      "label": "Inventory",
      "items": [
        { "label": "Items", "form": "InventItemForm" }
      ]
    },
    { "label": "Customers", "form": "CustTableForm" }
  ]
}
```

รองรับ nesting **ไม่จำกัดระดับ** — submenu ย่อยลงไปเรื่อยๆ

### Security Filtering

Menu items ที่ form ไม่มีสิทธิ์เข้า จะถูกกรองออกอัตโนมัติ (user ไม่เห็นปุ่มที่กดไม่ได้)

---

## 10. Business Logic: Hooks, Events, Actions

ทุก Business Logic เขียนใน `apps/<app>/src/logic.ts` — export `registerXxxLogic(kernel)`

```ts
import type { Kernel } from '@emu/core';
import { ValidationError } from '@emu/core';

export function registerErpLogic(kernel: Kernel): void {
  // Hooks, Events, Actions ...
}
```

### 10.1 Table Hooks (validateWrite, validateDelete, initValue)

Hooks คือ **table lifecycle methods** — ทำงานก่อน/ระหว่างการ write/delete

```ts
kernel.hooks.register('SalesTable', {
  validateDelete(rec) {
    // ป้องกันการลบ order ที่ post แล้ว
    if (rec.f.status === SalesStatus.Posted) {
      throw new ValidationError('Cannot delete a posted order');
    }
  },
  validateWrite(rec, ctx) {
    // ตรวจสอบก่อน save
  },
  initValue(rec, ctx) {
    // ตั้งค่าเริ่มต้นตอน new record
  },
});
```

### 10.2 Data Events (Pre/Post)

Events คือ **event handlers** — subscribe ก่อน/หลัง insert/update/delete

```ts
// Pre-events: สามารถ cancel ได้
kernel.events.on('SalesLine', 'onInserting', (e) => {
  // auto-compute lineAmount ก่อน insert
  e.record.f.lineAmount =
    (e.record.f.qty as number) * (e.record.f.salesPrice as number);
});

// Post-events: แจ้งเตือนหลังสำเร็จ
kernel.events.on('SalesLine', 'onInserted', (e) => {
  // update header total
  updateHeaderTotal(e.ctx, e.record.f.salesId as number);
});

// Cancel ได้ด้วย e.cancel(message)
kernel.events.on('SalesTable', 'onUpdating', (e) => {
  if (condition) e.cancel('เหตุผลที่ยกเลิก');
});
```

**Event Types:** `onValidating`, `onInserting`, `onInserted`, `onUpdating`, `onUpdated`, `onDeleting`, `onDeleted`

### 10.3 Actions (Server-Side Operations)

Actions คือ **named server operations** — เรียกจาก Form หรือ API

```ts
kernel.actions.set('SalesOrderPost', (ctx, args) => {
  const id = Number(args.id);
  return ctx.tts(() => {        // tts = transaction
    const order = ctx.find('SalesTable', id);
    if (!order) throw new ValidationError('Order not found');

    // ตรวจสอบ + ประมวลผล
    const lines = ctx.select('SalesLine').whereEq({ salesId: id }).toArray();
    for (const line of lines) {
      const item = ctx.find('InventItem', line.f.itemId as number);
      item.f.onHand = (item.f.onHand as number) - (line.f.qty as number);
      item.update();
    }

    order.f.status = SalesStatus.Posted;
    order.update();
    return { ok: true };
  });
});
```

เรียกจาก Form:
```json
{ "actions": [{ "label": "Post", "action": "SalesOrderPost" }] }
```

เรียกจาก API:
```
POST /api/action/SalesOrderPost
{ "id": 123 }
```

### 10.4 DataContext API

```ts
// Create
const rec = ctx.newRecord('CustTable');
rec.f.accountNum = 'C001';
rec.f.name = 'Contoso';
rec.setMany({ phone: '...', email: '...' });
rec.insert();    // returns same record with id set

// Read
const cust = ctx.find('CustTable', 1);
const list = ctx.select('CustTable')
  .whereEq({ accountNum: 'C001' })
  .orderBy('name', 'asc')
  .limit(10, 0)
  .toArray();
const first = ctx.select('CustTable').where('id', '>', 10).firstOnly();

// Update
const rec = ctx.find('CustTable', 1);
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

Extension App สามารถ subscribe events ของ base app ได้โดยไม่ต้องแก้ base code:

```ts
// erp.credit/src/logic.ts
kernel.events.on('SalesTable', 'onUpdating', (e) => {
  // credit limit check — cancel posting if over limit
  if (e.record.f.status !== SalesStatus.Posted) return;
  const cust = e.ctx.find('CustTable', e.record.f.custId as number);
  if (creditLimitExceeded) e.cancel('Over credit limit');
});
```

---

## 11. Security: Privilege → Duty → Role

Enterprise ERP security model: **Role → Duty → Privilege**

### 11.1 Privilege — สิทธิ์ระดับ Table/Form

```json
{
  "kind": "privilege",
  "name": "SalesOrderProcess",
  "label": "Process sales orders",
  "tablePermissions": [
    { "table": "SalesTable", "read": true, "create": true, "update": true, "delete": true },
    { "table": "SalesLine", "read": true, "create": true, "update": true, "delete": true },
    { "table": "CustTable", "read": true },
    { "table": "InventItem", "read": true, "update": true }
  ],
  "forms": ["SalesTableForm"]
}
```

### 11.2 Duty — กลุ่มของ Privileges

```json
{
  "kind": "duty",
  "name": "SalesOrderProcessing",
  "label": "Sales order processing",
  "privileges": ["SalesOrderProcess"]
}
```

### 11.3 Role — กลุ่มของ Duties + Privileges

```json
{
  "kind": "role",
  "name": "SalesManager",
  "label": "Sales manager",
  "duties": ["SalesOrderProcessing", "MasterDataMaintenance"]
}
```

Direct privileges (ไม่ผ่าน duty):
```json
{
  "kind": "role",
  "name": "ReadOnlyUser",
  "duties": [],
  "privileges": ["SomeReadOnlyPrivilege"]
}
```

### 11.4 การ Assign Role ให้ User

ผ่าน FW_UserRole table (จัดการผ่านหน้า Users ใน UI):

```
Users → เลือก user → Roles grid → เพิ่ม role
```

### 11.5 Admin Bypass

Hard-coded admin (`admin/admin`) มี `allowAll` policy — เข้าถึงทุก table, ทุก form

### 11.6 SystemAdminRole

```json
{
  "kind": "role",
  "name": "SystemAdminRole",
  "duties": ["SystemAdminDuty"]
}
```

Assign ได้กับ user ทั่วไปเพื่อให้สิทธิ์จัดการ user/role

---

## 12. Extension Model

### 12.1 Table Extension — เพิ่ม Field ให้ Table

```json
{
  "kind": "tableExtension",
  "name": "CustTable.CreditExt",
  "table": "CustTable",
  "fields": [
    { "name": "creditLimit", "type": "real" }
  ],
  "indexes": [
    { "name": "CreditIdx", "fields": ["creditLimit"] }
  ]
}
```

**กฎ:** ห้ามมี field ซ้ำกับที่มีอยู่แล้ว

### 12.2 Form Extension — เพิ่ม Field/Group ให้ Form

```json
{
  "kind": "formExtension",
  "name": "CustTableForm.CreditExt",
  "form": "CustTableForm",
  "listFields": ["creditLimit"],
  "groups": [
    { "label": "Credit", "fields": ["creditLimit"] }
  ]
}
```

### 12.3 Menu Extension — เพิ่ม Item ให้ Menu

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

### ข้อควรรู้

- Extension **ผนวก (append)** ข้อมูลเข้า base artifact — ไม่ overwrite
- Extension name ต้องไม่ซ้ำกันทั่วทั้งระบบ
- ใช้ `structuredClone` เพื่อป้องกันการ mutate object ของ caller
- Extension metadata อยู่ที่ `apps/<app>/metadata/<kind>Extensions/`
- รองรับทั้ง root-level และ module-level

---

## 13. Extension App (`dependsOn`)

Extension App คือ App ที่เพิ่มฟีเจอร์ให้ Base App โดยไม่แก้ Base Code

### Naming Convention (Dot Notation)

```
erp                  # Base app
erp.reporting        # Extension: Reporting
erp.credit           # Extension: Credit Limit
```

### การสร้าง

```bash
pnpm emu add app erp.integration   # wizard → "Is this an extension?" → Yes → dependsOn: [erp]
```

### โครงสร้าง Extension App

```
apps/erp.credit/
├── app.json           # { "name": "erp.credit", "dependsOn": ["erp"] }
├── package.json       # depends on "@emu/app-erp": "workspace:*"
├── src/logic.ts       # subscriber events, hooks เพิ่ม
└── metadata/
    ├── tableExtensions/
    └── formExtensions/
```

### dependsOn แบบ Multiple

Extension หนึ่ง extension สามารถ extend ได้หลาย base:

```json
{
  "name": "erp.advanced",
  "dependsOn": ["erp", "erp.reporting"]
}
```

---

## 14. การ Run Server & Client

### Development

```bash
pnpm dev                          # รัน server + client พร้อมกัน (คำสั่งเดียว, ข้าม OS ได้)

# หรือรันแยกกัน (สองหน้าต่าง terminal):
pnpm --filter @emu/server dev     # Start API server (port 3399)
pnpm --filter @emu/client dev     # Start Vite dev server (port 5199)
```

หรือใช้ script:
```bash
RunApp.cmd          # Windows — เปิด server + client
```

### Login

| User | Password | Roles |
|------|----------|-------|
| `admin` | `admin` | Framework administrator (seeded automatically, full access) |

### API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/login` | เข้าสู่ระบบ |
| `POST` | `/api/logout` | ออกจากระบบ |
| `GET` | `/api/me` | ข้อมูล user ปัจจุบัน + roles |
| `GET` | `/api/metadata` | Metadata ทั้งหมด (filter ตาม security) |
| `GET` | `/api/data/:table` | List records (filter, sort, pagination) |
| `GET` | `/api/data/:table/:id` | Get one record |
| `POST` | `/api/data/:table` | Create record |
| `PATCH` | `/api/data/:table/:id` | Update record |
| `DELETE` | `/api/data/:table/:id` | Delete record |
| `POST` | `/api/action/:name` | Execute server action |

---

## 15. การเขียน Test

ใช้ **Vitest** (test runner ของ framework)

### ตัวอย่าง Test

```ts
import { describe, it, expect } from 'vitest';
import { Kernel } from '@emu/core';
import { registerMyAppLogic } from '../src/logic.js';

describe('MyApp business logic', () => {
  function setup() {
    const kernel = new Kernel(':memory:');
    registerSystemApp(kernel);           // ถ้าต้องการ system tables
    kernel.loadAppFromDir('apps/myapp'); // โหลด metadata
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
pnpm -r test                        # รันทุก test
pnpm --filter @emu/app-erp test      # รัน test ของ ERP app
```

---

## 16. Best Practices

### 16.1 Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| App (base) | lowercase | `erp`, `crm` |
| App (extension) | `<base>.<feature>` | `erp.credit`, `erp.reporting` |
| Table | PascalCase | `SalesTable`, `CustTable` |
| Form | `<Table>Form` | `SalesTableForm` |
| Menu | PascalCase | `MainMenu` |
| Enum | PascalCase | `SalesStatus` |
| Privilege | PascalCase | `SalesOrderProcess` |
| Duty | PascalCase | `SalesOrderProcessing` |
| Role | PascalCase | `SalesManager` |
| Module (dir) | PascalCase | `Sales`, `Inventory` |
| Extension (name) | `<Base>.<Name>` | `CustTable.CreditExt` |

### 16.2 Metadata Organization

```
apps/<app>/metadata/
├── <Module>/           # จัดกลุ่มตาม module
│   ├── tables/
│   ├── enums/
│   ├── forms/
│   └── ...
├── menus/              # Menu ข้าม module
└── <Extension dirs>/   # Extensions
```

### 16.3 Business Logic

- **Hooks** → ใช้สำหรับ validate + init value (table-level logic)
- **Events** → ใช้สำหรับ side effects + cross-table updates
- **Actions** → ใช้สำหรับ complex transactions ที่เรียกจาก UI
- **Extension logic** → ใช้ events ของ base app ไม่ต้องแก้ base code

### 16.4 Security

- กำหนด Privilege ทุกครั้งที่สร้าง Table/Form ใหม่
- กลุ่ม Privileges เป็น Duty
- กลุ่ม Duties เป็น Role
- Assign Role ให้ User ผ่าน FW_UserRole

### 16.5 Transaction (tts)

ใช้ `ctx.tts()` สำหรับ operation ที่ต้องการ atomic rollback:

```ts
ctx.tts(() => {
  order.f.status = SalesStatus.Posted;
  order.update();
  // ถ้ามี error ระหว่างนี้ — rollback ทั้งหมด
  for (const line of lines) {
    item.update();
  }
});
```

### 16.6 Extension App Workflow

1. สร้าง extension app: `pnpm emu add app erp.myext`
2. เพิ่ม extension metadata: `pnpm emu add extension erp.myext tableExtension`
3. เขียน logic: subscribe events ของ base app
4. ลงทะเบียนใน `main.ts` (auto-register)

### 16.7 ข้อควรระวัง

- **อย่าแก้ base metadata โดยตรง** — ใช้ extension แทน
- **Schema sync เป็น additive** — ต้องลบ DB เองถ้าต้องการ recreate
- **Extension name ต้อง unique** — ห้ามซ้ำกับ extension อื่น
- **dependsOn ต้องเรียงลำดับถูก** — base apps ต้องโหลดก่อน extensions
- **SystemUser, SystemSession ถูก protect** — ไม่ expose ผ่าน generic data API

---

## 17. Web Designer — สร้าง App และ Customize จาก Browser

Web Designer เป็นเครื่องมือใน browser ที่ให้ admin สร้าง/แก้ไข metadata แบบ real-time
โดยไม่ต้อง restart server ทุกอย่างเก็บใน `FW_WebArtifact` table และ apply ทันที

### 17.1 การเข้าใช้งาน

- Login ด้วย `admin` (หรือ user ที่มี `FW_FrameworkUser`/`FW_SystemAdminRole`)
- เมนู **Development → Designer**

### 17.2 การสร้าง App ใหม่ (New Domain)

1. คลิก **New… → App (new domain)**
2. กรอก **Name** (lowercase, no spaces) และ **Label** (ชื่อแสดงผล)
3. Save → App ใหม่ปรากฏใน sidebar เป็นกลุ่มของตัวเอง

### 17.3 การสร้าง Table ภายใต้ App

1. คลิก **New… → Table (+ form + menu)**
2. เลือก **App** (sidebar group) — เลือกว่าจะให้ table นี้อยู่ภายใต้ app ไหน
   - เลือก app ที่มีอยู่ (เช่น app ที่คุณสร้างไว้ก่อนหน้า)
   - Default: app แรกที่ไม่ใช่ system
3. เลือก **Menu destination** — เมนูปลายทางที่ item ใหม่จะไปโผล่:
   - เลือกเมนูที่มีอยู่ (เช่น `MainMenu`) → framework สร้าง `menuExtension` ให้อัตโนมัติ → item ไปรวมกับเมนูนั้น ในกลุ่ม app นั้นเลย
   - เลือก `(new menu for ...)` → framework สร้างเมนูใหม่ให้ app นั้น
4. กรอก Name, Label, Fields
5. ติ๊ก **Create form** → framework สร้าง form ให้อัตโนมัติ
6. Save → table + form + menu item ปรากฏใน sidebar ทันที

### 17.4 Extension (เพิ่ม field ให้ Table เดิม)

1. Designer page → ส่วน **Customize existing tables** → คลิกชื่อ table
2. เพิ่ม fields → Save
3. Framework สร้าง `tableExtension` + `formExtension` ให้อัตโนมัติ

### 17.5 การสร้าง Form, Menu, Enum แบบเดี่ยว

- **New… → Form / Menu / Enum**
- Form: เลือก Table → ตั้งค่า listFields, groups
- Menu: เลือก items → เลือก form สำหรับแต่ละ item
- Menu รองรับ nested items (เมนูหลายระดับ)

### 17.6 JSON Tab

สำหรับ artifact ที่ไม่มี structured editor (หรือต้องการแก้ไข raw JSON) ให้สลับไปที่ **JSON** tab
แก้ JSON โดยตรง แล้วกด Save

### 17.7 การลบ

- **Del** ปุ่มหลังแต่ละ artifact → ลบออกจาก registry + DB
- Schema (columns/tables) **ไม่ถูก drop** — additive sync เท่านั้น

### 17.8 หลักการสำคัญ

- **App selector**: เลือก app ที่ object ไปสังกัด → sidebar จัดกลุ่มถูกต้อง
- **Menu destination**: เลือกเมนูปลายทาง → ใช้ `menuExtension` แทนการสร้างเมนูแยก
- **No server restart**: ทุกอย่าง apply ทันทีผ่าน `kernel.applyWebArtifacts()`
- **Branding**: ปรับชื่อระบบผ่าน env `EMU_APP_TITLE=MySystem` → แสดงบน login + sidebar

### 17.9 ข้อจำกัด (v1)

- ยังสร้าง **privilege/duty/role จากเว็บไม่ได้** — table ที่สร้างใหม่จากเว็บจึงเข้าถึงได้เฉพาะ admin จนกว่าจะเพิ่มสิทธิ์ผ่านไฟล์ metadata
- **Business logic เขียนจากเว็บไม่ได้** — hooks/events/actions ยังเป็น TypeScript ใน app
- **ลบ artifact ไม่ลบ column/table ใน SQLite** (additive-only) — ข้อมูลเดิมยังอยู่ แค่หายจากหน้าจอ
- Web layer สร้างของชื่อซ้ำกับ file app ไม่ได้ — ถ้าจะแก้ของเดิมให้ใช้ "Customize" (extension)

---

## 18. DirParty Pattern (Customer/Vendor → Party)

ทุก **Customer** และ **Vendor** จะมี record ใน **DirPartyTable** (module `Party` ของ app erp) ผูกอยู่เสมอ — เก็บชื่อและประเภท (Organization/Person) ไว้ที่ party เป็นศูนย์กลาง

### พฤติกรรมอัตโนมัติ (จาก `registerPartyLogic` ใน apps/erp/src/logic.ts)

- **สร้าง** CustTable/VendTable → framework สร้าง DirPartyTable record (name ตาม Cust/Vend, type = Organization) แล้ว set `partyId` ให้
- **แก้ชื่อ** Cust/Vend → ชื่อที่ party อัปเดตตาม
- **ลบ** Cust/Vend → party record ถูกลบด้วย
- ถ้า insert โดย**ระบุ `partyId` มาเอง** (เช่น data import) → ไม่สร้าง party ซ้ำ

### โครงสร้าง

```
DirPartyTable (Party/tables/)   ← name, partyType
   ↑ partyId (reference, readOnly)
CustTable (Customers/tables/)   VendTable (Vendors/tables/)
```

ดูรายการ party ทั้งหมดได้ที่เมนู **Customers → All parties** (form `DirPartyTableForm`)

---

## 19. System Requirements / ข้อกำหนดระบบ

EmuFramework รันเป็น **Node.js process เดียว** พร้อม **SQLite แบบ embedded** (ไม่มี DB server แยก)
ภาระงานหลักคือ CPU สำหรับ Fastify/Node event loop และ RAM สำหรับ Node heap + SQLite page cache

| ระดับการใช้งาน | CPU | RAM | Disk |
|---|---|---|---|
| Dev / Test / Demo | 1 vCPU | 512MB–1GB | 1GB+ |
| Production เริ่มต้น (<20 concurrent) | 1–2 vCPU | 2GB | 10–20GB SSD, persistent |
| Production ขนาดกลาง (20–100 concurrent) | 2–4 vCPU | 4–8GB | 40GB+ SSD, persistent |
| ขนาดใหญ่ (>100 concurrent) | ควรย้ายไป managed DB (Postgres) ก่อนขยาย | — | — |

ข้อกำหนดที่ต้องมีเสมอไม่ว่าจะขนาดไหน:

- **Long-running process** — ห้ามใช้ serverless/request-per-invocation เพราะ SQLite เก็บ state เป็นไฟล์บนดิสก์
- **Persistent disk/volume** ที่รอดจากการ redeploy — `data.db` และ `designer.db` คือข้อมูลทั้งหมดของระบบ

รายละเอียดแผน hosting ที่รองรับ (VPS, Railway, Render, Fly.io) พร้อมตาราง environment variables
ดูได้ที่ [README.md — Deployment](../README.md#deployment)
