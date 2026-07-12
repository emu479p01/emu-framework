# Recover from a failed update

## Procedure

1. Record the update job error and backup path from **System Maintenance**.
2. Check available disk space and application/updater logs.
3. Windows: inspect the timestamped framework backup and run `Update.cmd` after correcting the cause.
4. Docker: verify whether the sidecar restored the previous container, then follow the manual rollback procedure.
5. Start the previous framework version and verify data before retrying.
6. Restore the `.emubackup` only if data verification fails or release notes explicitly require database rollback.

Do not mix framework files from multiple releases. Preserve the failed state until logs and backups have been collected.

## Related topics

[Framework update](framework-update.md) · [Restore](restore.md)
