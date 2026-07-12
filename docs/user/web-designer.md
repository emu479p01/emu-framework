# Use the Web Designer

## Purpose

Create or customize metadata-driven apps from the browser.

## Prerequisites

Your account needs Designer permission for the target app.

## Procedure

1. Open **Web Designer** and select an existing app or create one.
2. Use **Simple Builder** to create a table, form, and menu entry together.
3. Add fields and validate their names and types.
4. Save, review the generated change set, and apply it.
5. Open the app and verify the form and list.

## Expected result

Metadata is stored in `designer.db`; additive schema changes are applied to the business database.

## Common errors

- Names are identifiers: use letters, numbers, and underscores without spaces.
- Destructive schema changes and native server code still require a developer.

## Related topics

[Metadata](../developer/metadata.md) · [Backup](../admin/backup.md)
