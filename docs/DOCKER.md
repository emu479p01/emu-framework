# Running EmuFramework with Docker

EmuFramework ships as a single Node.js process that serves both the API and the built web
client, so the container setup is intentionally simple: one image, one service, one volume for
the two SQLite database files.

## Quick start

```sh
docker compose up -d --build
```

This builds the image and starts the app at **http://localhost:3399**. On first boot it creates
`data.db` and `designer.db` inside the `emu-data` named volume, seeds the framework's metadata,
and creates a default `admin`/`admin` login — change that password immediately after your first
login.

Stop it with:

```sh
docker compose down
```

Your data stays in the `emu-data` volume between runs — `docker compose down && docker compose
up -d` brings the app back with everything intact. Only `docker compose down -v` (or manually
removing the volume) deletes your data.

## Building/running without Compose

```sh
docker build -t emuframework .
docker run -d --name emuframework \
  -p 3399:3399 \
  -v emu-data:/data \
  emuframework
```

## Configuration

Set environment variables via a `.env` file next to `docker-compose.yml` (Compose loads it
automatically) or with `docker run -e VAR=value`:

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3399` | Host port mapped to the container (Compose only — the app itself always listens on `3399` inside the container). |
| `EMU_APP_TITLE` | `EmuFramework` | The name shown on the login page and browser tab. |
| `EMU_SECURE_COOKIES` | unset | Set to `true` if you terminate TLS in front of this container (e.g. a reverse proxy) and want the login cookie marked `Secure`. `NODE_ENV=production` (already set by the image) has the same effect by default. |

`EMU_DB_PATH` and `EMU_DESIGNER_DB_PATH` are fixed to `/data/data.db` and
`/data/designer.db` in `docker-compose.yml` so they land on the persisted volume — leave them
as-is unless you're customizing the volume mount path too.

## Backing up your data

Both SQLite files (plus their `-wal`/`-shm` sidecar files) live in the `emu-data` volume:

```sh
docker run --rm -v emu-data:/data -v "$PWD":/backup debian \
  tar czf /backup/emu-backup.tar.gz -C /data .
```

## Putting it behind a reverse proxy / HTTPS

The container only serves plain HTTP on port 3399. Put nginx, Caddy, Traefik, or your hosting
platform's load balancer in front of it for TLS termination, and set `EMU_SECURE_COOKIES=true`
(or `NODE_ENV=production`, already set) so the login cookie is marked `Secure`.

## Notes

- The image is built from `node:24.18.0-slim` (Debian/glibc) rather than an Alpine base, because
  `better-sqlite3`'s prebuilt binaries aren't reliably published for musl libc — the build stage
  also installs `python3`/`make`/`g++` as a fallback in case no prebuilt binary matches your
  build platform (e.g. building for `linux/arm64` on Apple Silicon).
- `packages/cli` is built as part of `pnpm build` but isn't needed to run the app — it's the
  scaffolding tool (`pnpm emu`) for local development, not something the running server uses.
