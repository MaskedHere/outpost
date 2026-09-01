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
  license, no per-server monthly fee. Minecraft (vanilla, Paper, Fabric, Forge, NeoForge, Quilt,
  plus a BungeeCord/Waterfall/Velocity proxy), Terraria, Factorio, Valheim, Team Fortress 2, 7 Days
  to Die, and Project Zomboid, all free to run (no purchase or paid Steam account needed for the
  dedicated server itself). More on the roadmap.
- **Live console** with real commands (RCON) where the game supports it, a **file manager**, and
  one-click **backups** for every server.
- **Modpack Studio**: search [Modrinth](https://modrinth.com), build a pack, and either deploy it
  straight to a new server or **export a standard `.mrpack`** your friends open with one click in
  the Modrinth App or Prism Launcher — no rehosting mod jars, no messing with `mods/` folders by
  hand. Packs are also importable from an existing `.mrpack`, a CurseForge modpack zip, or a plain
  zip of `.jar` mods.

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

## Releasing

The `version` field in the repo-root `package.json` is the single source of truth for a release. It
is stamped into the faint version label in the UI's bottom-right corner at build time, and is what
the published image should be tagged with — so the number on screen always identifies the exact
build a machine is running, which is the quickest way to tell whether a deploy actually landed.

Bump it once per release, then build and push both tags together:

```bash
npm version patch --no-git-tag-version    # or edit package.json by hand
npm run build
VERSION=$(node -p "require('./package.json').version")
docker build -f packaging/Dockerfile -t ghcr.io/<owner>/outpost:latest -t ghcr.io/<owner>/outpost:"$VERSION" .
docker push ghcr.io/<owner>/outpost:latest
docker push ghcr.io/<owner>/outpost:"$VERSION"
```

Keeping `latest` and the version tag on the same digest means a NAS pulling `latest` reports the
same version the label shows.

## Architecture

One container, Fastify + TypeScript backend, React + TypeScript frontend, SQLite via Prisma,
`dockerode` to drive the host's Docker daemon, and the battle-tested
[`itzg/docker-minecraft-server`](https://github.com/itzg/docker-minecraft-server) image doing the
actual Minecraft server bootstrapping. Full write-up in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Roadmap

Built and working today: server lifecycle (create/start/stop/restart/delete), live console (RCON
where the game supports it), file manager, backups, Modrinth-backed modpack studio with dependency
resolution + `.mrpack`/CurseForge/zip import, `.mrpack` export, Docker packaging, and 8 games
beyond Minecraft (see above) via the `GameDefinition` plugin seam in `apps/backend/src/games/`.

Known gap: Garry's Mod has a working `GameDefinition` but its dedicated server segfaults on boot
against every Docker image tried so far (`Gamemode "sandbox" doesn't exist!` right before the
crash, despite the gamemode files being present on disk) — a known-hard-to-diagnose class of issue
for Source-engine servers. It's registered but not recommended until someone can dig further.

Deliberately not yet built:

- ARMA 3 (its dedicated server generally needs a paid Steam account, not just anonymous SteamCMD
  login, so it doesn't fit the "no purchase required" bar the other games meet)
- More PufferPanel-parity games (Rust, ARK, CS2, Squad, Starbound, Vintage Story, Eco, ...) —
  straightforward to add via the same `GameDefinition` seam, just not done yet
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
