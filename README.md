# EmuFramework

**Version: v0.0.0.6**

📦 [Download the latest release](https://github.com/emu479p01/emu-framework/releases)

**Build business apps by describing them, not coding them.** EmuFramework is a low-code,
metadata-driven platform for ERP, CRM, or any other line-of-business app. Declare your
tables, forms, and menus as JSON metadata, write your business logic in TypeScript — and the
client auto-generates every list page, detail page, and field control from that metadata. No
hand-built CRUD screens, ever.

This repository ships the framework itself (`packages/core|server|client|cli`). Business apps
aren't included — you scaffold them under `apps/` with one CLI command, and the platform can
host any number of independent apps, extensions, and web-designed customizations side by side.

## Why EmuFramework

- **Ship apps in days, not months** — describe a table and a form in JSON and the full
  list/detail UI, field controls, and line grids already work. No frontend code to write.
- **One platform, many apps** — host multiple independent business apps at once, each with
  its own sidebar, menu tree, and security policy, without them stepping on each other.
- **Extend without forking** — dot-named extensions (e.g. `crm.reporting`) add tables, forms,
  menus, and event handlers to an existing app without ever touching its base code.
- **Self-hosted, single process** — one Node.js process, an embedded SQLite database, no
  message queue, no separate frontend hosting, no vendor lock-in. Deploy it anywhere Node runs.
- **No-code Web Designer** — admins can create tables, forms, menus, and even entire new apps
  from the browser, live, with no deploy step.

## What it looks like

All reads and writes go through `DataContext`, so hooks, events, and security always apply —
whether the call comes from generated UI or your own code:

```ts
const member = ctx.newRecord('Member');
member.f.memberNo = 'M-001';
member.insert();

const loan = ctx.select('BookLoan').whereEq({ loanId: 'L-1' }).firstOnly();
ctx.tts(() => { /* transaction begin/commit with rollback */ });
```

## Stack

- **Core / server**: Node.js + TypeScript, Fastify, better-sqlite3
- **Client**: Vue 3 + Pinia + Naive UI — fully generated from metadata
- **DB**: SQLite with additive schema sync (create table / add column, never destructive)
- **Dev CLI**: `pnpm emu` — interactive scaffolding for apps, modules, objects, and extensions

## Project Structure

```
packages/core     kernel: metadata registry, schema sync, data API, events, security
packages/server   Fastify REST + session auth + generic /api/data + /api/action + Web Designer
packages/client   Vue engine: shell, auto list/form pages, field controls, designer UI
packages/cli      Dev tool: pnpm emu — scaffold apps, modules, objects, extensions
apps/*            Business apps you scaffold via 'pnpm emu add app' (none included by default)
```

The server (`@emu/server`) and client (`@emu/client`) are two separate packages during
development (client runs its own Vite dev server), but in production the server serves the
built client itself as static files — one process, one port, no separate frontend hosting.
The two SQLite database files (`data.db`, `designer.db`) are created automatically the first
time the server boots — they are never committed to the repo.

## Prerequisites

- **Windows:** none — `start.cmd` downloads its own pinned Node.js + pnpm into a local
  `.tools\` folder on first run (no admin rights, doesn't touch your system PATH). Just clone
  and double-click.
- **macOS/Linux/manual setup:** **Node.js 22.13+ / 24+ (LTS lines only)** and
  **pnpm 11.10.0** (`corepack enable && corepack prepare pnpm@11.10.0 --activate`)

## Quick Start

Windows users: clone the repo and double-click `start.cmd` — it downloads Node.js + pnpm if
needed, installs deps, starts server + client, and opens the browser automatically. Nothing
else to install first.

For macOS/Linux or a manual setup:

```sh
git clone https://github.com/emu479p01/emu-framework.git
cd emu-framework
corepack enable && corepack prepare pnpm@11.10.0 --activate
pnpm install   # installs all workspace deps; also builds packages/core automatically
pnpm dev       # starts API (3399) + client (5199) together, cross-platform
```

Prefer to run them separately (two terminals)?

```sh
pnpm --filter @emu/server dev   # API on http://127.0.0.1:3399
pnpm --filter @emu/client dev   # UI  on http://127.0.0.1:5199
```

Nothing needs to be created by hand — the first time the server boots it creates `data.db` and
`designer.db`, seeds the framework's metadata, and creates a default admin account.

## Run with Docker

Prefer containers? `docker compose up -d --build` builds the image and starts the app on
`http://localhost:3399`, persisting the two SQLite files in a named volume. See
[docs/DOCKER.md](docs/DOCKER.md) for details, env var overrides, and backup instructions.

## Usage

Default login: `admin/admin` (full access) — created automatically on first boot. Change this
password immediately.

```sh
pnpm -r test        # all test suites
pnpm -r typecheck
```

Scaffold new apps, modules, tables, forms, menus, and extensions interactively:

```sh
pnpm emu --help
```

See [docs/DEVELOPER-GUIDE.md](docs/DEVELOPER-GUIDE.md) for the full developer guide.

## Key Concepts

**Platform, not product** — EmuFramework is an app *platform*. You create apps on top of it. Each app
gets its own sidebar group, menu tree, and security policies. Extensions (dot-named like `crm.reporting`)
add features to existing apps without modifying base code.

**Metadata-driven UI** — apps declare `tables/enums/forms/menus/privileges/duties/roles` as JSON
under `metadata/`. The registry validates cross-references at boot; the client auto-generates all UI.
Menus support arbitrary nesting (modules, submenus, items).

**Data API (transactional, table-buffer style)** — all reads/writes go through `DataContext`, so hooks, events and
security always apply. See the code sample above for `newRecord`, `select`, and `tts`.

**Events & hooks** — `kernel.events.on('BookLoan', 'onUpdating', e => e.cancel('...'))`,
`kernel.hooks.register('BookLoan', { validateDelete })`. Pre-events can cancel the operation.
Extension apps subscribe to base app events without modifying base code.

**Extensions** — an app never modifies another app's artifacts; it ships
`tableExtensions/formExtensions/menuExtensions` JSON plus event subscriptions. The registry
merges them into the effective metadata at load time. `dependsOn` supports multiple references.

**Security** — privileges grant table CRUD + form entry points, duties group privileges, roles
group duties. Enforced inside the data kernel (403 over REST). User↔role assignments managed
via the built-in Users page (Admin role).

**Web Designer** — admins can create tables, forms, menus, and even entire new apps from the
browser. Artifacts are stored in the database (`SystemWebArtifact`) and applied live. When
creating tables, select the target app and menu destination — the new item appears under
that app's sidebar group automatically via menuExtension.

**CLI Developer tool** — `pnpm emu` scaffolds apps, hierarchical modules, metadata objects
(tables, forms, menus, security), and extensions interactively. See `pnpm emu --help`.

## Branding

Set `EMU_APP_TITLE=MyAppName` environment variable to customize the login page and sidebar title.
Default: "EmuFramework".

## System Requirements

EmuFramework runs as a **single Node.js process** with an **embedded SQLite database** (no
separate DB server, no network round-trip for data access). That makes sizing simple: the
main costs are CPU for the Fastify/Node event loop and RAM for the Node heap + SQLite page
cache.

| Usage level | CPU | RAM | Disk | Example specs |
|---|---|---|---|---|
| Dev / test / demo | 1 vCPU | 512MB–1GB | 1GB+ (persistence not critical) | Fly.io free/shared-1x, Railway trial |
| Small production (<20 concurrent users) | 1–2 vCPU | 2GB | 10–20GB SSD, **persistent** | DigitalOcean 2GB/1vCPU droplet, Railway Hobby + volume, Render Starter + disk, Fly.io shared-cpu-1x/1GB + volume |
| Medium production (20–100 concurrent users, fast-growing data) | 2–4 vCPU | 4–8GB | 40GB+ SSD, persistent | DigitalOcean 4GB/2vCPU droplet, Render Standard + disk, comparable VPS |
| Large scale (100+ concurrent, heavy workload) | Migrate off SQLite to a managed DB (e.g. Postgres) before scaling further — SQLite is single-writer/file-based and doesn't scale horizontally | — | — | — |

Two hard requirements regardless of scale:
- **Long-running process** — no serverless/request-per-invocation hosting. SQLite state lives
  in files on disk that a single persistent process reads/writes.
- **Persistent disk/volume** that survives redeploys — `data.db` and `designer.db` are 100%
  of your data (see [Where your data lives](#where-your-data-lives--backing-it-up) below).

## Deployment

EmuFramework deploys as a **single Node.js process**. That one process serves both the API
and the web UI (the built client is served as static files by the same server), so there's
no separate frontend hosting and no CORS setup to configure.

### Build & run

```sh
pnpm install   # installs deps; also builds packages/core automatically
pnpm build     # compiles core, server, and client for production
```

Set the environment variables you need (see table below), then start it:

```sh
PORT=3399 \
HOST=0.0.0.0 \
NODE_ENV=production \
EMU_DB_PATH=/var/lib/emuframework/data.db \
EMU_DESIGNER_DB_PATH=/var/lib/emuframework/designer.db \
pnpm start
```

`pnpm start` runs `node packages/server/dist/main.js`. On first boot it creates both SQLite
files automatically (if they don't already exist) and seeds an `admin`/`admin` login — **change
that password immediately after your first login.**

### Keeping it running

A plain `node` process stops if the server reboots or the process crashes. Use a process
manager so it restarts automatically:

```sh
npm i -g pm2
pm2 start packages/server/dist/main.js --name emuframework
pm2 save
```

(A `systemd` service works just as well if you prefer that instead of `pm2`.)

### Environment variables

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3399` | Port the server listens on. Many hosting platforms set this for you automatically. |
| `HOST` | `0.0.0.0` | Which network interface to bind. `0.0.0.0` accepts connections from anywhere (needed for real hosting); `127.0.0.1` only works for local access. |
| `EMU_APP_TITLE` | `EmuFramework` | The name shown on the login page and browser tab. |
| `EMU_DB_PATH` | `./data.db` | Where the main application database file lives. Point this at your persistent folder in production. |
| `EMU_DESIGNER_DB_PATH` | `./designer.db` | Where the metadata/designer database file lives. Point this at your persistent folder in production. |
| `NODE_ENV` | unset | Set to `production` in deployment. This marks the login cookie `Secure` (HTTPS-only) — required if your host serves the app over HTTPS (most do). Leave unset for local development over plain HTTP. |

### Supported hosting

The app needs a **long-running Node.js process** (not request-per-invocation) and a
**persistent disk** that survives redeploys (for the two SQLite files) — SQLite is an embedded,
file-based database, not a managed DB service.

| Hosting type | Supported? | Recommended spec | Notes |
|---|---|---|---|
| VPS (DigitalOcean, Linode, Vultr, Hetzner, AWS EC2, GCP Compute Engine, etc.) | ✅ Yes | 1–2 vCPU / 2GB RAM to start; scale to 4 vCPU / 4–8GB as usage grows | Full control; run `pnpm build && pnpm start` directly, ideally behind `pm2`/`systemd`. |
| Railway | ✅ Yes | Hobby/Pro plan sized to 1–2 vCPU / 2GB+ | Attach a persistent volume for the two `.db` files. |
| Render | ✅ Yes (paid tier) | Starter/Standard instance + persistent disk add-on | Requires a persistent disk add-on — the free tier has no persistent storage. |
| Fly.io | ✅ Yes | shared-cpu-1x with 1GB+ RAM to start | Attach a Fly volume for the two `.db` files. |
| Any Docker-capable host | ✅ Yes | Same as VPS above | Use the included `Dockerfile`/`docker-compose.yml` — see [docs/DOCKER.md](docs/DOCKER.md). |
| Static hosting (GitHub Pages, Netlify/Vercel static sites) | ❌ No | — | There's no process to run the server at all — these only serve static files. |
| Serverless functions (Vercel Functions, Netlify Functions, plain AWS Lambda) | ❌ No | — | Filesystem is ephemeral/read-only between invocations, so SQLite writes don't persist. Would require migrating to a managed database first — out of scope for now. |

### Where your data lives / backing it up

Both `EMU_DB_PATH` and `EMU_DESIGNER_DB_PATH` point at plain SQLite files — together they are
**100% of your application's data**. Back them up regularly, and always before upgrading:

```sh
cp /var/lib/emuframework/data.db /var/lib/emuframework/designer.db /path/to/backup/
```

If those files are ever deleted, the app will simply create fresh empty ones and reseed the
default `admin`/`admin` account on next boot — all your data will be gone.

### First login

Default credentials are `admin` / `admin`. Log in and change the password right away; this
account is only meant to get you started, not to be used long-term.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
