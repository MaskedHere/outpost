# Architecture

Outpost is one Docker container (the "panel") that manages sibling game-server containers through
the Docker Engine API. There's no separate agent or daemon to install, which is the point of
targeting a NAS: one app, one install.

```
                         ┌─────────────────────────────┐
  browser  ───HTTP/WS──▶ │   outpost (this container)  │
                         │  Fastify API + static React │
                         └──────────────┬──────────────┘
                                        │ Docker Engine API
                                        │ (/var/run/docker.sock)
                        ┌───────────────┼────────────────┐
                        ▼               ▼                ▼
                  game server 1   game server 2    game server N
```

## Backend (`apps/backend`)

- **Fastify** HTTP and WebSocket server in TypeScript, with single-admin JWT cookie auth.
- **`docker/`** is a thin `dockerode` wrapper: container lifecycle, polling CPU/memory stats, and
  port/volume/secret wiring built from a `CreateContainerSpec`. Nothing else in the codebase knows
  Docker specifics.
- **`games/`** holds one `GameDefinition` per game (see `games/types.ts`). Each maps a variant,
  version, memory, and settings choice to a `CreateContainerSpec` (image, ports, volumes, env, cmd)
  and registers in `games/registry.ts`; routes and the frontend don't change when a game is added.
  Supported today: Minecraft Java (`itzg/minecraft-server`, including a Velocity/Waterfall/BungeeCord
  proxy via `itzg/mc-proxy`), Minecraft Bedrock, Terraria and tModLoader, Factorio, Valheim,
  Palworld, Team Fortress 2, 7 Days to Die, and Project Zomboid. Some images only read a generated
  secret or config from a file, so definitions can declare a `preCreate` hook that writes into the
  bind-mounted volume before the container starts (see Factorio's `rconpw`).
- **`rcon/client.ts`** is a from-scratch client for Valve's binary Source RCON protocol. Minecraft
  copied the same wire format, so one client covers Minecraft, Factorio, TF2, Project Zomboid, and
  Palworld, connecting over the network to each container's published RCON port. Games without
  RCON (Valheim, Terraria, 7 Days to Die, Bedrock) are logs-only: `GameServer.rconPort` is `null`
  and the console has no command input.
- **`modrinth/`** contains the Modrinth API client, a required-dependency resolver, loader-version
  lookup for export, the `.mrpack` builder, and `import.ts`, which turns an uploaded `.mrpack`,
  CurseForge pack, or zip of jars back into an editable `Pack`. Jars bundled in an upload are matched
  against Modrinth by SHA-1 hash; anything unrecognized is kept and deployed as a local file.
- **`curseforge/`** reads CurseForge through a headless Chromium (Playwright), since its search
  pages sit behind a bot challenge and its API requires a key.
- **`routes/`** exposes the REST API plus one WebSocket route (`/ws/servers/:id/console`). Console
  output streams from `docker logs -f` via the bundled CLI (`docker/cli.ts`), because `dockerode`'s
  attach/log streams didn't reliably deliver data on the Docker transports tested. Commands go in
  over RCON when the game has it.
- **`services/`** holds the long-running logic: readiness detection, crash recovery, the shared
  game-content cache, player tracking, and the public-access options (UPnP, playit.gg,
  bore).
- Server data (`/data/servers/<id>`) is bind-mounted into both the panel (for the file manager and
  backups) and the game container, so there's no copying or exec-ing into containers for file
  access. The exception is Team Fortress 2, whose image bakes its server into the path it would
  need mounted, so TF2 servers have no persistent volume.

## Frontend (`apps/frontend`)

React, Vite, TypeScript, and Tailwind, built to static files and served by the backend in
production, so the whole app is one container on one port.

## Modpack flow

1. Search Modrinth or CurseForge and add mods to a `Pack`. Adding a mod resolves its full required
   dependency tree up front and pins each dependency to a specific version, so the runtime image
   never resolves dependencies on its own.
2. **Deploy** creates a server whose container gets `MODRINTH_PROJECTS=<project:version,...>`; the
   itzg image downloads them at boot. Mods Outpost already holds as files are copied into the
   server's `mods/` folder instead.
3. **Share** streams a standard [`.mrpack`](https://docs.modrinth.com/modpacks/format/): a
   `modrinth.index.json` manifest pointing at Modrinth's CDN, with no rehosted jars. Friends open it
   in the Modrinth App or Prism Launcher.

## Data layout

| Path (inside container) | Host path (ZimaOS)                    | Purpose                              |
| ----------------------- | ------------------------------------- | ------------------------------------ |
| `/data/config`          | `/DATA/AppData/outpost/config`        | SQLite database                      |
| `/data/servers/<id>`    | `/DATA/AppData/outpost/servers/<id>`  | One server's world and config files  |
| `/data/backups/<id>`    | `/DATA/AppData/outpost/backups/<id>`  | `tar.gz` snapshots                   |
| `/data/packs`           | `/DATA/AppData/outpost/packs`         | Stored mod files and pack overrides  |
| `/data/game-cache`      | `/DATA/AppData/outpost/game-cache`    | Shared per-game SteamCMD content     |

See the [README](../README.md) for the roadmap.
