# Outpost

[![CI](https://github.com/MaskedHere/outpost/actions/workflows/ci.yml/badge.svg)](https://github.com/MaskedHere/outpost/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**A self-hosted game server panel for your home NAS.** Spin up a server for the group chat in a
couple of clicks, build a modpack in the browser, and hand your friends a one-click client pack.
No monthly hosting bill.

Outpost runs as a single Docker container on [ZimaOS](https://www.zimaspace.com/zimaos) or any
Docker-capable Linux box, and manages each game server as its own sibling container.

## Why I built this

I run a ZimaOS NAS at home, and every so often my friends and I want to play something together:
a modded Minecraft pack one month, Valheim or Palworld the next. The options were paying a hosting
company monthly for something we'd play for two weeks, or SSH-ing into the NAS to hand-edit compose
files, env vars, and `mods/` folders every time. Existing panels either cost money (AMP) or expect
a dedicated server setup with a separate daemon to run alongside them.

I wanted one app, one install, and a UI clean enough that a friend could run a server without
calling me. Outpost is that tool. I use it on my own NAS, and most features exist because I hit
the problem myself.

## Features

- **10 games, one panel.** Minecraft Java (vanilla, Paper, Fabric, Forge, NeoForge, Quilt, plus a
  Velocity/Waterfall/BungeeCord proxy), Minecraft Bedrock, Terraria and tModLoader, Factorio,
  Valheim, Palworld, Team Fortress 2, 7 Days to Die, and Project Zomboid. All of them run free,
  with no game purchase or paid Steam account needed for the dedicated server.
- **Real server management.** Live console with RCON commands, file manager, one-click backups and
  restores, a live CPU/RAM/player graph, and player management (kick, ban, op) where the game
  supports it.
- **Modpack Studio.** Search Modrinth and CurseForge, add mods with their required dependencies
  resolved and pinned automatically, deploy the pack to a server, and export a standard `.mrpack`
  that friends open in one click with the Modrinth App or Prism Launcher. Existing packs import from
  `.mrpack`, CurseForge modpacks and server packs, or a plain zip of jars, and packs imported from
  Modrinth can check for and move to the newest release.
- **More mod sources.** Reusable Steam Workshop packs (Project Zomboid, tModLoader), Factorio Mod
  Portal browsing, CurseForge Palworld mods, and Paper plugins from Modrinth.
- **Public access without router surgery.** Per server, choose automatic UPnP port mapping, a
  playit.gg tunnel, or a bore.pub relay.
- **Built to recover on its own.** Crash-loop detection, automatic quarantine of the mod named in a
  Forge crash report, readiness checks that wait for the game (not just the container), a shared
  per-game cache so new SteamCMD servers skip multi-GB downloads, and recovery of orphaned server
  data after a reinstall.

## Quick start

Outpost needs Docker and access to the Docker socket.

```bash
docker run -d \
  --name outpost \
  --restart unless-stopped \
  -p 7420:3000 \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e RCON_HOST=host.docker.internal \
  -e HOST_DATA_DIR=/DATA/AppData/outpost \
  --add-host host.docker.internal:host-gateway \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /DATA/AppData/outpost:/data \
  ghcr.io/maskedhere/outpost:latest
```

Open `http://<your-nas>:7420` and create the admin account. On ZimaOS you can instead import
[`packaging/docker-compose.yml`](packaging/docker-compose.yml) as a custom app. The full guide is
in [`docs/ZIMAOS_INSTALL.md`](docs/ZIMAOS_INSTALL.md).

> **Security:** Outpost controls the host's Docker daemon, which is root-equivalent access (the
> same trust model as Portainer). Run it only on hardware you own, keep it off the public internet,
> and set the admin password on first launch. It refuses to start with a placeholder `JWT_SECRET`.

## How it works

- **Backend:** Node.js 22, TypeScript, and Fastify serve a REST API plus a WebSocket console
  stream. Prisma manages a SQLite database, with migrations applied automatically on container
  start. `dockerode` drives the Docker daemon.
- **Games are plugins.** Each game is a `GameDefinition` in `apps/backend/src/games/` that maps a
  user's choices (variant, version, memory, settings) to a container spec: image, ports, volumes,
  and env. Adding a game doesn't touch routes, lifecycle code, or the frontend. The Settings tab
  renders each game's options from a declarative schema.
- **One RCON client for everything.** A from-scratch implementation of Valve's binary Source RCON
  protocol covers Minecraft, Factorio, Palworld, Project Zomboid, and TF2.
- **Frontend:** React, Vite, TypeScript, and Tailwind, built to static files and served by the
  backend, so the whole app is one container on one port.
- **CI:** GitHub Actions lints, generates the Prisma client, and builds both apps on every push.

The full write-up is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Extra notes worth reading if your truely interested

A few problems that took real debugging, and how Outpost handles them:

- **"Running" isn't "ready."** Docker reports a container as running long before the world has
  loaded, and a bare TCP probe can succeed against a host-side proxy before anything is listening.
  Outpost confirms readiness with an authenticated RCON round trip, or a game-specific log line for
  games without RCON.
- **Probing Terraria costs a save.** Connecting to Terraria's game port makes the server treat
  the probe as a joining player and run a full save cycle, so its readiness comes from the log
  instead.
- **Crash loops hide behind restart policies.** Under `unless-stopped`, a crashing container is
  back within seconds, so polling only ever saw a fresh boot. Outpost watches Docker's
  `RestartCount`, and when a Forge crash report names the mod that broke the boot, it moves that
  file aside and restarts.
- **Bind mounts resolve on the host.** Outpost creates containers through the host's daemon, so
  paths have to be translated from Outpost's own `/data` to the host path (`HOST_DATA_DIR`).
  Otherwise the daemon fails with `mkdir /data: read-only file system`.
- **Log streaming.** `dockerode`'s attach and log streams didn't reliably deliver data on the
  Docker transports I tested, so the live console streams `docker logs -f` from the bundled CLI.

## Local development

Requires Node.js 22+ and a running Docker daemon.

```bash
npm install
cp apps/backend/.env.example apps/backend/.env   # then set JWT_SECRET
npm run prisma:migrate
npm run dev:backend    # API on http://localhost:3000
npm run dev:frontend   # UI on http://localhost:5173 (proxies /api and /ws to :3000)
```

Local server, backup, and database data lands in `.data/` at the repo root (gitignored).

```bash
npm run lint
npm run build                                   # both apps
docker build -f packaging/Dockerfile -t outpost .
```

## Releasing

The `version` in the root `package.json` is the single source of truth. It's stamped into the
version label in the UI's bottom-right corner at build time and used as the image tag, so the
number on screen always identifies the exact build a machine is running.

```bash
npm version patch --no-git-tag-version
npm run build
VERSION=$(node -p "require('./package.json').version")
docker build -f packaging/Dockerfile -t ghcr.io/maskedhere/outpost:latest -t ghcr.io/maskedhere/outpost:"$VERSION" .
docker push ghcr.io/maskedhere/outpost:latest
docker push ghcr.io/maskedhere/outpost:"$VERSION"
```

On ZimaOS, update by changing the image tag **and restarting the app**. Changing the tag alone
doesn't pull the new image.

## Roadmap

- More games (Rust, ARK, CS2, Vintage Story, and others) through the same `GameDefinition`
  interface
- Multi-user accounts with role-based access (currently one admin account)
- Scheduled backups (manual backups work today)
- Forge/NeoForge loader-version pinning in exported `.mrpack` files (Fabric and Quilt are pinned)
- An automated test suite
- Listing in the ZimaOS/CasaOS community App Store

## License

[MIT](LICENSE) © 2026 Lamar Nielsen
