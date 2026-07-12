# Troubleshoot the system

## App does not start

Check ports, free disk space, runtime versions, and logs. Windows users can run `status.cmd`; Docker users can run `docker compose ps` and `docker compose logs --tail=200`.

## Update check fails

Confirm access to GitHub Releases and GHCR. A proxy, DNS rule, API rate limit, missing updater token, or private package visibility can block the request.

## Database errors

Stop writes, preserve the database and WAL files, and create a filesystem copy before attempting recovery. Never edit a production SQLite file directly.

## Related topics

[Recovery](recovery.md) · [Database storage](database-storage.md)
