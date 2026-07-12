# Configure the application

## Purpose

Set runtime values without editing application source.

## Settings

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | HTTP port | `3399` |
| `EMU_APP_TITLE` | Display title | `EmuFramework` |
| `EMU_DB_PATH` | Business SQLite file | deployment default |
| `EMU_DESIGNER_DB_PATH` | Designer SQLite file | deployment default |
| `EMU_SECURE_COOKIES` | Require HTTPS cookies | production dependent |
| `EMU_UPDATER_TOKEN` | App-to-sidecar secret | required for Docker update |

Restart the app after changing environment values. Use HTTPS and `EMU_SECURE_COOKIES=true` on an internet-facing deployment.

## Related topics

[Docker installation](docker-install.md) · [Troubleshooting](troubleshooting.md)
