# Operate Docker

## Common commands

```sh
docker compose up -d
docker compose stop
docker compose start
docker compose ps
docker compose logs --tail=200 app
docker compose logs --tail=200 updater
docker compose pull
```

Use `docker compose down` only when the containers and network should be removed; the named volume remains. Never add `-v` unless deleting all application data is intentional.

## Manual rollback

1. Keep the verified pre-update backup.
2. Set `EMU_VERSION` in `.env` to the previous known-good version.
3. Run `docker compose pull && docker compose up -d`.
4. Restore databases only when a documented migration requires it; container rollback does not alter database files.

## Related topics

[Docker installation](docker-install.md) · [Database storage](database-storage.md)
