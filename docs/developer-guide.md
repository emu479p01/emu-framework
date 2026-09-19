# EmuFramework developer guide — localization and Data Entity extensions (v1.2.0)

This guide shows the metadata shapes introduced in v1.2.0 with copy-ready examples. Everything shown here can also be produced from the Web Designer without writing JSON; the JSON forms are the durable contract behind the screens.

## App default locale

An app manifest may declare `defaultLocale`. Tags are BCP-47 and are canonicalized with `Intl.getCanonicalLocales` (for example `th-th` becomes `th-TH`). Apps without the property keep the default `en`.

```json
{
  "kind": "app",
  "name": "app2",
  "label": "แอป 2",
  "defaultLocale": "th",
  "models": [{ "name": "Main", "label": "Main", "layer": "SYS" }]
}
```

- The stored `label` always remains the last-resort text, even when it is written in another language.
- In the Web Designer the field is called **Default language** (App editor). Saving warns when the chosen locale has no translation resources yet.
- The property round-trips through the file manifest, the Web Designer, metadata package import/export, and runtime metadata.

## Translations

Translations reuse the existing `translation` kind. Multiple Translation artifacts per locale are allowed (per Model or Layer); for the same key and locale the higher layer wins (`SYS → ISV → LOC → DEV → CUS`) and the artifact name decides between equal layers, so results never depend on load order.

```json
{
  "kind": "translation",
  "name": "APP2_Thai",
  "app": "app2",
  "model": "Main",
  "layer": "SYS",
  "locale": "th",
  "resources": {
    "app.app2.label": "แอป 2",
    "form.APP2_OrderForm.label": "ใบสั่งซื้อ",
    "table.APP2_OrderTable.field.description.label": "รายละเอียด",
    "form.APP2_OrderForm.action.confirm.label": "ยืนยัน"
  }
}
```

Key conventions (shared by the runtime resolver and the Designer's Translation editor):

| Target | Resource key |
| --- | --- |
| App | `app.<app>.label` |
| Model | `model.<app>.<model>.label` |
| Table / Field | `table.<table>.label` / `table.<table>.field.<field>.label` |
| Enum / Value | `enum.<enum>.label` / `enum.<enum>.value.<value>.label` |
| Form | `form.<form>.label` |
| Form group / action / line | `form.<form>.group.<id>.label` etc. |
| Menu item | `menu.<menu>.item.<id>.label` |
| Report parameter / text element | `report.<report>.parameter.<field>.label` / `report.<report>.element.<id>.text` |
| View, chart, privilege, duty, role, data entity | `<kind>.<name>.label` |
| Framework UI (reserved) | `ui.*` |

Rules worth remembering:

- Keys starting with `ui.` are reserved for the framework (`FW_UiEn`, `FW_UiTh` ship read-only system translations).
- A translation may target another app's artifacts only when its own app declares that dependency; otherwise the resource is ignored.
- Duplicate keys per locale and keys whose target no longer exists produce Designer warnings (`GET /api/designer/translations/diagnostics`) instead of load failures.
- An empty cell in the Translation editor means "do not override": the key is dropped from `resources` on save.

## Per-key fallback order

For every key the resolver walks this chain, de-duplicated case-insensitively:

```text
User locale (exact) → base language of the user locale
→ owner app's defaultLocale (exact) → its base language
→ stored label → component name
```

Example with `User = en-GB` and `App defaultLocale = th-TH`: `en-GB → en → th-TH → th → stored label`.

### App-1 / App-2 result table

| User locale | App | Translations available | defaultLocale | Result |
| --- | --- | --- | --- | --- |
| en | App-1 | en, th | en | English |
| en | App-2 | th | th | Thai |
| th | App-1 | en, th | en | Thai |
| ja | App-2 | th | th | Thai |
| en | legacy app | none | not set | stored label |

The user locale is never rewritten automatically when entering an app that does not support it.

## Data Entity extensions

The `dataEntityExtension` kind appends to an existing Data Entity. It can add root fields, whole new lines, or extra fields on existing lines — nothing else.

```json
{
  "kind": "dataEntityExtension",
  "name": "APP2_Customization_APP2_OrderEntity_Extension",
  "app": "app2",
  "model": "Customization",
  "layer": "CUS",
  "dataEntity": "APP2_OrderEntity",
  "fields": ["remark"],
  "lineExtensions": [
    { "name": "Lines", "fields": ["remark"] }
  ]
}
```

Merge rules:

- `fields` appends fields that really exist on the root table and are not already present.
- `lines` appends new lines; the line name must not collide with an existing line.
- `lineExtensions` appends fields to existing lines only.
- `rootTable`, `businessKey`, line tables, `parentReference`, `lineKeys`, and archive settings can never be changed through an extension — the schema rejects those properties outright.
- Adding a field to the entity does not create the table field; provide a `table` or `tableExtension` first.
- Extensions follow the existing naming, dependency, and higher-layer rules, and the merged entity is validated as a whole after merging.

Runtime impact: import, export, and archive read the merged entity from the registry. Archives created before an extension still restore — missing fields follow the import/default rules, and a newly mandatory field without a default produces a clear error while the archive is preserved.

## Related API additions

- `GET /api/metadata` now returns `locale`, `availableLocales`, `uiMessages`, and `apps[].defaultLocale` / `apps[].availableLocales`.
- `PATCH /api/me/locale` canonicalizes the tag (`th-th` → `th-TH`) and rejects invalid tags with an error naming the field.
- `GET /api/attachments/:attachmentId/preview` streams PNG/JPEG attachments inline with signature verification; the download endpoint is unchanged.
