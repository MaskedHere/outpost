# Outpost

Outpost is a free, open-source game server panel built for [ZimaOS](https://www.zimaspace.com/zimaos)
(and any other Docker-capable NAS/Linux box). It's an alternative to paying a monthly fee for
Minecraft/game hosting just so a friend group can play together for a couple of weeks: spin up a
server in a couple of clicks, build a modpack right in the app, and hand your friends a
ready-to-play client pack with one button.

> **Status: early / MVP.** The core loop works end-to-end (see below), but this is a young project.
> See [Roadmap](#roadmap) for what's deliberately not built yet.

## What it does

- **Run game servers as Docker containers**, managed from a clean web UI — no PufferPanel/AMP
  license, no per-server monthly fee. Minecraft (vanilla, Paper, Fabric, Forge, NeoForge, Quilt) at
  launch, more games on the roadmap.
- **Live console**, a **file manager**, and one-click **backups** for every server.
- **Modpack Studio**: search [Modrinth](https://modrinth.com), build a pack, and either deploy it
  straight to a new server or **export a standard `.mrpack`** your friends open with one click in
  the Modrinth App or Prism Launcher — no rehosting mod jars, no messing with `mods/` folders by hand.

## Install on ZimaOS

See [`docs/ZIMAOS_INSTALL.md`](docs/ZIMAOS_INSTALL.md). Short version: import
[`packaging/docker-compose.yml`](packaging/docker-compose.yml) as a custom app, set a real
`JWT_SECRET`, and open the app to create your admin account.

Outpost isn't in the ZimaOS/CasaOS community App Store yet — that's on the roadmap. It works today
via manual/custom install.

**Security note:** Outpost manages sibling containers through the host's Docker socket, which gives
it root-equivalent power on the machine (same model as Portainer/Watchtower). Don't expose it
directly to the internet, and set the admin password immediately on first launch.

## Local development

Requires Node.js 22+ and a running Docker daemon.

```bash
npm install
cp apps/backend/.env.example apps/backend/.env   # then edit JWT_SECRET
npm run prisma:migrate
npm run dev:backend    # http://localhost:3000 (API)
npm run dev:frontend   # http://localhost:5173 (UI, proxies /api and /ws to :3000)
```

Local server/backup/db data lands in `.data/` at the repo root (gitignored).

```bash
npm run lint
npm run build           # builds both apps
docker build -f packaging/Dockerfile -t outpost .
```

## Architecture

One container, Fastify + TypeScript backend, React + TypeScript frontend, SQLite via Prisma,
`dockerode` to drive the host's Docker daemon, and the battle-tested
[`itzg/docker-minecraft-server`](https://github.com/itzg/docker-minecraft-server) image doing the
actual Minecraft server bootstrapping. Full write-up in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Roadmap

Built and working today: server lifecycle (create/start/stop/restart/delete), live console, file
manager, backups, Modrinth-backed modpack studio with dependency resolution, `.mrpack` export,
Docker packaging.

Deliberately not yet built:

- Game engines beyond Minecraft (the internal `GameDefinition` plugin seam exists for this —
  see `apps/backend/src/games/`)
- Multi-user accounts / role-based access (currently: one admin account)
- Scheduled/automatic backups (manual backup button exists; no cron yet)
- Forge/NeoForge loader-version pinning in exported `.mrpack` files (Fabric/Quilt are fully
  supported; Forge/NeoForge packs still export but omit the exact loader-build pin — see
  `apps/backend/src/modrinth/loaderVersions.ts`)
- Submission to the ZimaOS/CasaOS community App Store
- Mobile-polished UI, i18n, automated update checks, a real test suite

Contributions welcome — open an issue or PR.

## License

[MIT](LICENSE)
