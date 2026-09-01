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
  polling-based CPU/mem stats read (`docker stats`, non-streaming). `containers.ts` builds a
  container's port bindings, volume mounts, and (if the game needs one) an env-file-style secret
  from a `CreateContainerSpec` returned by a `GameDefinition` — nothing else in the codebase knows
  about Docker specifics.
- **`games/`** — the "game definition" seam (see `games/types.ts`). Each file maps a
  variant/version/memory choice into a `CreateContainerSpec` (image, ports, volumes, env/cmd) for
  one Docker image, and registers in `games/registry.ts` — nothing in `routes/` or the frontend
  has to change to add another. Shipped today: Minecraft (`itzg/minecraft-server`, incl. a
  BungeeCord/Waterfall/Velocity proxy variant via `itzg/mc-proxy`), Terraria, Factorio, Valheim,
  Garry's Mod, Team Fortress 2, 7 Days to Die, and Project Zomboid — all free-to-run (no paid
  Steam account or purchase required for the dedicated server itself). A few of these needed a
  `preCreate` hook (writes a file into the bind-mounted volume *before* the container starts) for
  images whose entrypoint only picks up a generated secret from a config file rather than an env
  var — see `factorio.ts`'s `rconpw` handling.
- **`rcon/client.ts`** — a from-scratch client for Valve's Source RCON wire protocol. Minecraft's
  RCON is a direct copy of the same format, so this one client covers every RCON-capable game
  Outpost supports (Minecraft, Factorio, Garry's Mod, TF2, Project Zomboid), connecting straight
  over the network to the container's published RCON port rather than shelling into it. Not every
  game has RCON (Valheim has no admin console at all; Terraria's vanilla server needs a real TTY
  that this environment can't reliably attach to, and 7 Days to Die's available Docker images
  don't expose one) — those are logs-only: `GameServer.rconPort` is `null` and the console tab
  just tails `docker logs -f` with no command input.
- **`modrinth/`** — a small client for the public [Modrinth API](https://docs.modrinth.com/api/),
  a required-dependency resolver, best-effort mod-loader-version lookup (Fabric/Quilt meta APIs),
  the `.mrpack` builder, and `import.ts` (parses an uploaded `.mrpack`, CurseForge zip, or plain
  zip of `.jar`s back into an editable `Pack` — CurseForge packs are matched to Modrinth projects
  by name since Outpost has no CurseForge API key and only ever redistributes via Modrinth's CDN).
- **`routes/`** — REST endpoints plus one WebSocket route (`/ws/servers/:id/console`) for the live
  console. Output always streams from `docker logs -f` (`docker/cli.ts` spawns the CLI directly —
  dockerode's own `attach()`/`logs()` streams never reliably delivered data on the Docker
  transports this was tested against, while shelling out to the bundled `docker` CLI does).
  Commands go in via `rcon/client.ts` when `rconPort` is set.
- Server data (`/data/servers/<id>`) is bind-mounted straight from the host into both the panel
  container (for the file manager/backups) and the game-server container — no copying, no exec-ing
  into containers for file access. (One exception: Team Fortress 2's image bakes its entrypoint
  and installed server directly into the path it'd otherwise need mounted, so that one has no
  persistent volume in v1 — it still runs and has a live console, it just won't survive container
  recreation or show up in Files/Backups.)

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
