# Model deployment and ISV licenses (1.3.0)

## Deploying selected models

In Designer, open the app menu and choose **Build deployment package**. Select one mode:

| Mode | Allowed layers | Destination behavior |
| --- | --- | --- |
| Vendor update | SYS, ISV, LOC | Replace only the selected models; preserve destination DEV/CUS and every unselected model. |
| UAT → Prod | SYS, ISV, LOC, DEV, CUS | Replace every selected model with its complete source snapshot, including removal of obsolete metadata. |

Packages are created from Designer metadata. File-based apps must continue to use their existing file deployment process. Framework app `system` is not deployable. Model names and layers are stable identities: deployment cannot move an artifact between models, change an existing model's layer, or overwrite a file-based artifact. A selected model may be empty to remove all its artifacts while retaining its definition.

Import the JSON file in Designer at the destination. Preview lists creations, changes, metadata removals, schema effects and preserved models. Existing app labels, locale and other app-level settings are retained; required app dependencies are merged. New apps use the package manifest. Missing dependencies and incompatible extensions block the entire deployment. Dependencies are never selected automatically. Install required dependencies or rebuild the package, then preview again. Confirmation uses a short-lived, user-bound preview and checks the destination revision again.

The destination validates the complete resulting registry, including local customizations and dependent apps. DEV/CUS are preserved as metadata, but arbitrary executable code cannot be proven compatible statically. Test vendor updates against representative customer customizations in UAT. Scripts are trusted server code and should register handlers rather than perform external side effects during deployment; an external email or HTTP request cannot be rolled back with SQLite.

Data tables and columns are not dropped when their metadata disappears. Metadata deployment does not transfer business data, users, installation identity, trusted keys or installed licenses. Do not embed passwords or credentials in metadata or script source. Use the separate data-management workflow for business data. Back up data and designer stores together before deployment. Database transactions and runtime snapshots restore failed applies; a machine failure between commits to the two independent SQLite stores still requires the full-backup recovery procedure.

Selected-model packages use `schemaVersion: 2`, with scope `{ type: "models", app, mode: "vendor" | "promotion", models: [...] }`. Existing version-1 app/model packages retain their merge behavior and remain importable. Older framework versions reject version-2 packages. `POST /api/designer/packages/models/:app/export` accepts `{ mode, models: [modelName, ...] }`. Import preview and confirmation use the existing package/change-set APIs. Checksums detect corruption; they are not vendor signatures.

## Inventory and licensing setup

System administrators can open **Settings → Apps & Models** to inspect models, layers, source, metadata revision, dependencies, deployment history and license status. License audit contains trust changes, import successes/rejections and observed status changes. Revisions are metadata hashes, not vendor marketing version numbers.

Licensing is optional and applies only to ISV models declaring `license: { vendor: "seller-id" }`. The Designer model dialog exposes the vendor ID. Existing models without this property continue to operate unchanged. Ordinary model edits and deployments cannot remove or change an installed license requirement. Deleting an entire app remains a separate administrative operation.

Register the customer ID and the vendor's Ed25519 public key in Apps & Models. Verify the key with the seller through your agreed channel before trusting it. Customer registration and a vendor's registered key cannot be replaced through the ordinary UI. Private keys stay with the seller and must never be copied to the customer deployment. Key rotation is outside this release.

Each installation generates its own installation ID in the designer database. Give the seller the customer ID, installation ID, app and model names. UAT and Prod need separately issued licenses. Do not clone a complete designer database to provision a new environment: that would clone its installation identity. A full backup is for recovery of the same installation; a model package is for promotion between installations.

## Seller CLI

Generate a key pair once, keeping the private file in a protected seller-only location:

```sh
node scripts/isv-license.mjs keygen /secure/path/seller
```

Create a payload file, using UTC timestamps and the exact destination identifiers:

```json
{
  "version": 1,
  "vendor": "seller-id",
  "customer": "customer-id",
  "installationId": "installation-id-from-system-admin",
  "app": "sales",
  "model": "Addon",
  "notBefore": "2026-09-22T00:00:00Z",
  "expiresAt": "2027-09-22T00:00:00Z",
  "sequence": 1
}
```

```sh
node scripts/isv-license.mjs issue /secure/path/seller.private.pem payload.json customer-license.json
```

The CLI refuses to overwrite existing output files. The signed bytes are UTF-8 JSON of the payload's top-level keys sorted with `localeCompare`; the signature is Ed25519 encoded as base64. Transfer only the resulting license JSON and the public key. The customer imports the license through Apps & Models. To renew, issue a file with the same identifiers, a later expiry and a strictly increasing sequence number. A renewal must already be valid when imported, to avoid replacing an active license with one that has not started. Initial future-dated licenses are accepted but do not permit writes before `notBefore`. Expired files are rejected.

## Expiry behavior

The system warns within 30 days of expiry. Missing, invalid, not-yet-valid or expired required licenses put the owning app and transitive dependent apps into read-only operation with no grace period. Metadata stays loaded. Reading, ordinary data exports, backups and license administration remain available. Business writes, actions, functions, import, attachment updates and archive processing are guarded server-side. Transactional writes are checked again before commit. Async actions cannot undo external effects already performed before expiry; any subsequent framework data write is checked again. Registered script hooks and actions retain their owning app's guard even when invoked by another app.

After a valid renewal is imported, the next request may write without redeploying or restarting. Refresh an already-open page to update its displayed license warning. Apps & Models exposes status even when business operations are restricted.

This is offline licensing with no online revocation. It detects tampering with signed license payloads, but cannot prevent an owner of the server/source/database from modifying the enforcement code, replacing stored trust or rolling back the machine clock and backups. It does not sandbox trusted executable scripts or native extensions with raw database/system access.

## Upgrade verification

For the 1.3.0 preparation, a disposable installation was created from Git tag `1.2.0` and then opened with 1.3.0. Verification retained the administrator login, business row, CUS field/model, Recent/Favorites and version-1 package preview; license storage was added without restricting old models. Automated tests additionally cover selected-model preservation/deletion, ownership conflicts, dependency failure, stale previews, persistence rollback, license signatures, renewal replay, expiry rollback and app-scoped navigation.
