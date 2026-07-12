# Restore databases

## Purpose

Replace both databases from a verified `.emubackup` package.

## Procedure

1. Validate the package in **System Maintenance**.
2. Stop the application and keep the current databases as an additional copy.
3. On Windows run `RestoreDatabase.cmd "C:\path\backup.emubackup"`.
4. For Docker, extract the validated database files into the stopped `emu-data` volume using an administrative container.
5. Start the app and verify login, apps, and recent records.

Never replace a live SQLite file by copying over it. Restore both databases from the same package.

## Related topics

[Backup](backup.md) · [Recovery](recovery.md)
