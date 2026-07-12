# Update the framework

## Purpose

Install the latest stable GitHub Release while preserving apps and databases.

## Web procedure

1. Sign in as a Framework Administrator.
2. Open **System Maintenance** and choose **Check for updates**.
3. Review the version and release notes.
4. Choose **Update to latest stable** and confirm downtime.
5. Keep the page open while it reconnects and verify the final status.

The system creates and validates a `.emubackup` before starting. Windows verifies release SHA-256; Docker pulls the immutable GHCR version tag and restores the previous container if health checks fail.

## Manual fallback

- Windows: run `Update.cmd`.
- Docker: set `EMU_VERSION` to the required stable version, then run `docker compose pull app && docker compose up -d app`.

Updates support only forward movement to the latest stable version. Database rollback is never automatic.

## Related topics

[Backup](backup.md) · [Recovery](recovery.md)
