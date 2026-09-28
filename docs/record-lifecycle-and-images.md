# Record lifecycle, audit fields and Function images (1.4.0)

## New-record drafts

Opening **New** on a form no longer inserts a row. The client calls `POST /api/data/:table/drafts`, which runs field defaults and every `initValue` hook in a transaction and returns an opaque `token` plus the initial `record`. Values set by `initValue` — including read-only and mandatory fields such as document numbers — are shown immediately but nothing is written to the business table.

`POST /api/data/:table/drafts/:token/save` merges the user's writable values over the stored snapshot and inserts the record.

- Drafts are stored encrypted in `FW_RecordDraft` in the data database, are bound to the creating user and table, and expire after 24 hours. They survive a server restart.
- A failed save (validation error or a throwing event) rolls the insert back and leaves the draft usable; `initValue` is not run again.
- A repeated save of the same token returns the record already created instead of inserting twice.
- An expired or foreign token, or a draft created before a table/script/Function metadata change, is rejected with `409`. The user opens a new draft; the values they typed are kept in the page.
- Read-only fields cannot be overwritten from the request body. Create permission and app licenses are checked when the draft is created and again when it is saved.

A read-only field may now also be `mandatory` when an `initValue` hook supplies it.

## Audit aliases

Every table exposes read-only virtual fields `sys_createdBy`, `sys_createdAt`, `sys_modifiedBy` and `sys_modifiedAt`. They map to the existing `createdBy`, `createdAt`, `modifiedBy` and `modifiedAt` columns — no physical columns are added — and can be used in list filters, sorting, `Query.where`/`orderBy`, Record `get`, and View field references. Table metadata returned by `/api/metadata` includes them.

Updates always keep the original `createdAt`/`createdBy`; request bodies cannot forge audit values. System field names are reserved case-insensitively. If an existing table already has a physical column named like an alias, schema sync stops before making any change and reports the collision.

## Synchronous lifecycle handlers

`initValue`, `validateWrite`, `validateDelete` and data event handlers run inside the database transaction and must be synchronous. Registering an `async` function, or a handler that returns a Promise, raises `async lifecycle handlers are not supported`. Use an `async` Function (`executionMode: 'async'`) for awaited or external work.

## Datetime values

Datetime values are stored and returned as UTC ISO strings (`2026-08-15T15:52:39.000Z`). Input with an offset is converted to UTC; legacy values without an offset are treated as UTC. The client displays datetimes in the browser time zone and sends UTC back. Number fields display with grouping separators; IDs, references and strings are shown unformatted.

## Functions with image input

A Function can request images attached to an existing record:

```json
{ "kind": "function", "name": "SALES_ScanReceipt", "imageInput": { "table": "SALES_Order", "recordIdArgument": "recordId", "multiple": true }, "code": "..." }
```

- `table` must be a business table (not `FW_*`). `recordIdArgument` names the argument that carries the record ID.
- The Function dialog lets users choose files or take a photo (JPEG, PNG or WebP). Images are uploaded when the user confirms, as attachments of the record, using a client-generated `uploadId` so retries do not duplicate files. If one upload fails, successful uploads are kept and only the failed file is retried.
- The server checks Function permission, update permission on the record, file signature and ownership, then passes `attachmentIds` to the Function. Images belonging to another record or user are rejected.
- Uploaded images remain attached if the Function itself fails.

`/api/metadata` publishes only `name`, `label` and `imageInput` for permitted Functions in `functionInputs`; Function code is never sent to the client.

## Branding and deployment previews

`EMU_APP_TITLE` sets the product name in the browser title (for example `Sales Orders - Company`) and on the login and setup pages.

Deployment previews start collapsed with add/change/remove and high-risk counts. Expanding them lists each artifact, including where moved or deleted artifacts came from.
