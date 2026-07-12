# Back up databases

## Purpose

Create one verified package containing business data and Designer metadata.

## Procedure

1. Open **System Maintenance** as a Framework Administrator.
2. Select **Export Full Backup**.
3. Store the `.emubackup` file outside the application host.
4. Use **Validate Restore File** to verify its manifest and checksums.

The package contains `data.db`, `designer.db`, and `manifest.json`. Schedule additional host-level copies according to your recovery requirements.

## Related topics

[Restore](restore.md) · [Database storage](database-storage.md)
