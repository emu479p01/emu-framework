# AI Developer Guide

**Version: v0.0.0.8**

EmuFramework exposes metadata context and validation without granting an AI permission to
apply changes, delete artifacts, execute scripts, run SQL, or read business records.

## Change-set workflow

1. Run `pnpm emu inspect --json` and keep the returned revision.
2. Read `pnpm emu schema --json` and create a version-1 change-set JSON file.
3. Run `pnpm emu validate changes.json --json`. Validation is side-effect free.
4. A developer runs `pnpm emu apply changes.json`, reviews the diff, and confirms it.

```json
{
  "version": 1,
  "baseRevision": "<revision from inspect>",
  "source": "ai",
  "description": "Add customer notes",
  "operations": [
    {
      "op": "upsert",
      "kind": "tableExtension",
      "name": "SALES_CustomerNotes",
      "artifact": {
        "kind": "tableExtension",
        "name": "SALES_CustomerNotes",
        "app": "sales.custom",
        "model": "Customizations",
        "layer": "CUS",
        "table": "SALES_Customer",
        "fields": [{ "name": "notes", "type": "string", "label": "Notes" }]
      }
    }
  ]
}
```

Stale revisions are rejected. AI-sourced script and script-extension operations are always
rejected. Deleting table metadata preserves the physical SQLite table as an orphan; data purge
is intentionally outside the AI workflow.

Framework administrators can permanently purge an orphan only through
`POST /api/designer/orphans/:table/purge` with a request body whose `confirmation` exactly
matches the table name. Active metadata and all `FW_` tables are refused.

## Local MCP server

Build the packages, then configure an MCP client to run the server over stdio:

```sh
pnpm --filter @emu/core build
pnpm --filter @emu/mcp build
node packages/mcp/dist/index.js
```

Set `EMU_WORKSPACE_ROOT` when the MCP process starts outside the repository. The server exposes:

- Resources: metadata schema, change-set schema, workspace summary, and per-app snapshots.
- Tools: `inspect_workspace`, `inspect_app`, `validate_change_set`, and `explain_diagnostics`.
- Prompts: `create_business_app` and `extend_app_safely`.

There is deliberately no apply, delete, SQL, business-data, or script-execution tool.

## Designer HTTP contract

- `GET /api/designer/capabilities`
- `GET /api/designer/snapshot?app=<name>`
- `POST /api/designer/change-sets/validate`
- `POST /api/designer/change-sets/apply`

Validate returns a session-bound preview ID that expires after ten minutes. Apply requires an
authenticated Designer user, matching customization scope, an unchanged base revision, and
explicit human confirmation. High-risk changes require a second confirmation. Applied change
sets are recorded in `FW_ChangeSetAudit` in the designer database.
