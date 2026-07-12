# Install with Docker

## Purpose

Run immutable EmuFramework images with persistent database storage.

## Prerequisites

Docker Engine with Compose and access to `ghcr.io`.

## Procedure

1. Create `.env` beside `docker-compose.yml`.
2. Add a random token of at least 24 characters: `EMU_UPDATER_TOKEN=...`.
3. Optionally set `PORT`, `EMU_APP_TITLE`, and `EMU_SECURE_COOKIES=true`.
4. Run `docker compose pull && docker compose up -d`.
5. Run `docker compose ps` and open `http://localhost:3399`.

## Expected result

The app uses the `emu-data` volume. The updater has no public port.

## Common errors

- Do not commit `.env`.
- The updater mounts `/var/run/docker.sock`, which grants host-level Docker control. Disable the updater and use the manual procedure if that risk is unacceptable.

## Related topics

[Docker operations](docker-operations.md) · [Framework update](framework-update.md)
