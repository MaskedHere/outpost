# Architecture

Outpost is one Docker container (the "panel") that manages sibling game-server containers via the
Docker Engine API. There's no separate agent/daemon process to install — that's the whole point of
targeting a NAS: one app, one install, done.

```
                         ┌─────────────────────────────┐
  browser  ───HTTP/WS──▶ │   outpost (this container)  │
                         │  Fastify API + static React │
                         └──────────────┬──────────────┘
                                        │ Docker Engine API
                                        │ (/var/run/docker.sock)
                        ┌───────────────┼────────────────┐
                        ▼               ▼                ▼
                 game-server-1   game-server-2     game-server-N
                (itzg/minecraft- (itzg/minecraft-  (itzg/minecraft-
                  server image)    server image)     server image)
```

## Backend (`apps/backend`)

- **Fastify** HTTP + WebSocket server, TypeScript, single admin-account JWT-cookie auth.
- **`docker/`** — thin `dockerode` wrapper: create/start/stop/restart/remove a container, and a
  polling-based CPU/mem stats read (`docker stats`, non-streaming).
- **`games/`** — the "game definition" seam. Only `minecraft.ts` exists today; it maps a
  loader/version/memory/mod-list into a container spec for the
  [`itzg/docker-minecraft-server`](https://github.com/itzg/docker-minecraft-server) image, which
  does the actual heavy lifting of installing and booting the right server jar. Adding a new game
  later means implementing `GameDefinition` (see `games/types.ts`) and registering it in
  `games/registry.ts` — nothing in `routes/` or the frontend has to change.
- **`modrinth/`** — a small client for the public [Modrinth API](https://docs.modrinth.com/api/),
  a required-dependency resolver, best-effort mod-loader-version lookup (Fabric/Quilt meta APIs),
  and the `.mrpack` builder.
- **`routes/`** — REST endpoints plus one WebSocket route (`/ws/servers/:id/console`) that attaches
  directly to a running container's stdio for the live console.
- Server data (`/data/servers/<id>`) is bind-mounted straight from the host into both the panel
  container (for the file manager/backups) and the game-server container — no copying, no exec-ing
  into containers for file access.

## Frontend (`apps/frontend`)

React + Vite + TypeScript + Tailwind, built to static files and served by the backend in
production so the whole app is one container/one port. `xterm.js` renders the live console.

## Modpack Studio → "share with friends" flow

1. User searches Modrinth and adds mods to a `Pack` (SQLite). Adding a mod resolves its full
   *required*-dependency tree up front and pins each one to a specific Modrinth version — Outpost
   never asks the runtime image to resolve dependencies itself.
2. **Deploy**: creates a real server whose container gets `MODRINTH_PROJECTS=<comma-separated
   version ids>` — the itzg image downloads and installs them at boot.
3. **Share (.mrpack)**: streams a standard [`.mrpack`](https://docs.modrinth.com/modpacks/format/)
   zip — a `modrinth.index.json` manifest pointing at official Modrinth CDN URLs, no rehosted jars.
   Friends open it with the Modrinth App or Prism Launcher and it just installs.

## Data layout on the host

| Path (inside container) | Host path (ZimaOS) | Purpose |
|---|---|---|
| `/data/config` | `/DATA/AppData/outpost/config` | SQLite DB |
| `/data/servers/<id>` | `/DATA/AppData/outpost/servers/<id>` | one server's world/config files |
| `/data/backups/<id>` | `/DATA/AppData/outpost/backups/<id>` | tar.gz snapshots |

See the [README](../README.md) for what's deliberately out of scope for v1.
