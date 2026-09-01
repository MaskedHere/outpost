import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { prisma } from '../db/client.js';
import type { PackItem } from '../../generated/prisma/index.js';
import { config } from '../config.js';
import { getGameDefinition } from '../games/registry.js';
import { createServerContainer, getContainer, removeContainer, stopContainer } from '../docker/containers.js';
import { allocatePorts } from '../docker/ports.js';
import { startInstallingMaps } from './tf2MapsService.js';
import { changeMap } from './mapService.js';
import { restoreCacheInto } from './contentCacheService.js';

export class ServerCreationError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
  }
}

/** Whether a pack item deploys via itzg's MODRINTH_PROJECTS mechanism (fetched from Modrinth's CDN
 *  at container start) or by copying an already-downloaded file straight into the server's mods
 *  folder (see copyLocalPackItems) comes down to localFilePath, not PackItem.source — a CurseForge
 *  Server Pack's embedded jar that hash-matched a Modrinth project is still source: 'modrinth' (for
 *  a real display name/version, and .mrpack export), but Outpost already has its exact bytes on
 *  disk, so it deploys from there rather than redundantly re-fetching the same file from Modrinth. */
function modrinthOnly(items: { projectId: string | null; versionId: string | null; localFilePath: string | null }[]) {
  return items
    .filter((item) => item.projectId && item.versionId && !item.localFilePath)
    .map((item) => ({ projectId: item.projectId!, versionId: item.versionId! }));
}

async function copyLocalPackItems(dataPath: string, items: { localFilePath: string | null; filename: string }[]) {
  const localItems = items.filter((item) => item.localFilePath);
  if (localItems.length === 0) return;
  const modsDir = path.join(dataPath, 'mods');
  await fs.mkdir(modsDir, { recursive: true });
  await Promise.all(
    localItems.map((item) => fs.copyFile(path.join(config.packsDir, item.localFilePath!), path.join(modsDir, item.filename))),
  );
}

/** Mirrors a CurseForge pack's stored overrides/ folder (configs, resourcepacks, scripts — see
 *  modpacks.ts's persistOverrideFiles) directly into the new server's dataPath, same relative
 *  layout (overrides/config/x.toml -> dataPath/config/x.toml). A no-op if the pack has none. */
async function copyPackOverrides(dataPath: string, packId: string) {
  const overridesDir = path.join(config.packsDir, packId, 'overrides');
  const entries = await fs.readdir(overridesDir, { withFileTypes: true, recursive: true }).catch(() => []);
  await Promise.all(
    entries
      .filter((e) => e.isFile())
      .map(async (e) => {
        const src = path.join(e.parentPath, e.name);
        const rel = path.relative(overridesDir, src);
        const dest = path.join(dataPath, rel);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.copyFile(src, dest);
      }),
  );
}

export interface CreateServerInput {
  name: string;
  game?: string;
  variant?: string;
  version?: string;
  memoryMb: number;
  packId?: string;
  workshopCollectionId?: string;
  workshopItemIds?: string[];
  modIds?: string[];
  motd?: string;
  extraSettings?: Record<string, string>;
  /** Seed this server from the shared game-content cache instead of letting it download the whole
   *  game from Steam again (see contentCacheService). Defaults to on; turning it off gives a server
   *  that fetches everything itself — slower, but it keeps nothing pre-staged on disk. */
  useContentCache?: boolean;
}

export async function createServer(input: CreateServerInput) {
  let variant = input.variant ?? '';
  let version = input.version ?? '';
  let modrinthMods: { projectId: string; versionId: string }[] = [];
  let packItems: PackItem[] | null = null;
  const game = input.packId ? 'minecraft' : (input.game ?? 'minecraft');

  if (input.packId) {
    const pack = await prisma.pack.findUnique({ where: { id: input.packId }, include: { items: true } });
    if (!pack) throw new ServerCreationError('Pack not found', 404);
    variant = pack.loader;
    version = pack.mcVersion;
    modrinthMods = modrinthOnly(pack.items);
    packItems = pack.items;
  }

  const gameDef = getGameDefinition(game);
  if (!gameDef.variants.includes(variant)) {
    throw new ServerCreationError(`Unsupported variant for ${gameDef.displayName}: ${variant}`, 400);
  }

  const id = crypto.randomUUID();
  const containerName = `outpost-${id}`;
  const dataPath = path.join(config.serversDir, id);
  await fs.mkdir(dataPath, { recursive: true });
  if (packItems) await copyLocalPackItems(dataPath, packItems);
  if (input.packId) await copyPackOverrides(dataPath, input.packId);

  const rconPassword = crypto.randomBytes(12).toString('hex');
  const spec = gameDef.buildContainerSpec({
    name: input.name,
    containerName,
    dataPath,
    memoryMb: input.memoryMb,
    variant,
    version,
    rconPassword,
    modrinthMods,
    workshopCollectionId: input.workshopCollectionId,
    workshopItemIds: input.workshopItemIds,
    modIds: input.modIds,
    motd: input.motd,
    extraSettings: input.extraSettings,
  });

  // Seed the game files from the shared cache before the container ever starts, so its SteamCMD
  // pass finds everything already on disk and just verifies instead of re-downloading it all.
  // Wrapping preCreate (rather than editing containers.ts) puts this at exactly the right moment:
  // after the volume directories exist, but before any game def writes its own per-server files
  // into them — which matters for 7 Days to Die, whose serverconfig.xml lives in the same directory
  // and must end up being this server's copy, not the cached one's.
  if (gameDef.contentCache && input.useContentCache !== false) {
    const cacheSubdir = gameDef.contentCache.subdir;
    const gameOwnPreCreate = spec.preCreate;
    spec.preCreate = async (hostPaths) => {
      const dest = hostPaths[cacheSubdir];
      if (dest) await restoreCacheInto(game, dest).catch(() => false);
      if (gameOwnPreCreate) await gameOwnPreCreate(hostPaths);
    };
  }

  const hostPorts = await allocatePorts(spec.ports.length);
  const gamePortIndex = spec.ports.findIndex((p) => p.purpose === 'game');
  const rconPortIndex = spec.ports.findIndex((p) => p.purpose === 'rcon');
  if (gamePortIndex === -1) throw new Error(`${gameDef.displayName} container spec has no 'game' port`);

  let containerId: string;
  try {
    const container = await createServerContainer(spec, hostPorts, { 'outpost.serverId': id });
    containerId = container.id;
    try {
      await container.start();
    } catch (startErr) {
      await removeContainer(container.id);
      throw startErr;
    }
  } catch (err) {
    await fs.rm(dataPath, { recursive: true, force: true });
    throw new ServerCreationError(
      `Failed to create game server container: ${err instanceof Error ? err.message : String(err)}`,
      502,
    );
  }

  const rconPort = rconPortIndex === -1 ? null : hostPorts[rconPortIndex]!;

  const created = await prisma.gameServer.create({
    data: {
      id,
      name: input.name,
      game,
      variant,
      version,
      containerId,
      containerName,
      gamePort: hostPorts[gamePortIndex]!,
      rconPort,
      // Stored even when this game has no RCON port: some defs (Valheim) reuse this generated
      // secret as a game join password instead, and it's useful to surface either way.
      rconPassword,
      memoryMb: input.memoryMb,
      dataPath,
      packId: input.packId ?? null,
      motd: input.motd ?? null,
      workshopCollectionId: input.workshopCollectionId ?? null,
      workshopItemIds: input.workshopItemIds ? JSON.stringify(input.workshopItemIds) : null,
      modIds: input.modIds ? JSON.stringify(input.modIds) : null,
      extraSettings: input.extraSettings ? JSON.stringify(input.extraSettings) : null,
    },
  });

  // TF2 always boots on cp_badlands (the only map baked into the base image — see tf2.ts) since
  // every other stock map needs a one-time steamcmd validate pass to exist on disk at all. If the
  // player picked something else, kick that install off now instead of leaving them stuck on
  // badlands until they notice and hit "Install extra maps" themselves, and land on their actual
  // choice automatically once it's done.
  if (game === 'tf2' && variant !== 'cp_badlands') {
    startInstallingMaps(containerId, (ok) => {
      if (!ok) return;
      changeMap(game, rconPort, rconPassword, variant).catch(() => undefined);
    }).catch(() => undefined);
  }

  return created;
}

/** Docker has no way to change an existing container's env vars (e.g. Minecraft's JVM heap comes
 *  from a MEMORY env var baked in at creation), so the only correct way to change memory after the
 *  fact is to rebuild the container from the exact same spec with the new value — a live
 *  `docker update --memory` alone would raise the cgroup cap but leave the JVM's -Xmx untouched.
 *  Reuses the same container name, data path, and — critically — the exact same host ports, so
 *  nothing depending on them (the stored gamePort/rconPort, an active tunnel) needs to change.
 *  extraSettings works the same way (env vars baked in at creation, so a behavior setting like
 *  allow-flight needs the same rebuild too) — omit it to leave the server's current settings as-is,
 *  or pass an object (including {}) to replace them outright. */
export async function updateServerMemory(serverId: string, memoryMb: number, extraSettings?: Record<string, string>) {
  const server = await prisma.gameServer.findUnique({
    where: { id: serverId },
    include: { pack: { include: { items: true } }, plugins: true },
  });
  if (!server) throw new ServerCreationError('Server not found', 404);
  if (!server.containerId) throw new ServerCreationError('Server has no container to resize', 400);

  const gameDef = getGameDefinition(server.game);
  // Mods (from an attached Pack) and plugins (per-server, Paper-only) both ride on the same
  // MODRINTH_PROJECTS mechanism — itzg's image sorts out mods-vs-plugins itself based on TYPE, and
  // a server only ever has one or the other populated in practice (Pack is modded-loader-only,
  // ServerPlugin is Paper-only), so concatenating is always safe, never actually mixes the two.
  const modrinthMods = [
    ...(server.pack ? modrinthOnly(server.pack.items) : []),
    ...server.plugins.map((p) => ({ projectId: p.projectId, versionId: p.versionId })),
  ];

  const spec = gameDef.buildContainerSpec({
    name: server.name,
    containerName: server.containerName,
    dataPath: server.dataPath,
    memoryMb,
    variant: server.variant,
    version: server.version,
    rconPassword: server.rconPassword ?? '',
    modrinthMods,
    workshopCollectionId: server.workshopCollectionId ?? undefined,
    workshopItemIds: server.workshopItemIds ? JSON.parse(server.workshopItemIds) : undefined,
    modIds: server.modIds ? JSON.parse(server.modIds) : undefined,
    motd: server.motd ?? undefined,
    extraSettings: extraSettings ?? (server.extraSettings ? JSON.parse(server.extraSettings) : undefined),
  });

  // 'game' and 'rcon' host ports are already durably recorded on the server row itself — reading
  // them from there instead of live docker inspect means a resize still works even if the
  // container isn't currently inspectable (crashed, or just exited — Docker drops a bridge-network
  // container's NetworkSettings.Ports once it's stopped, e.g. after a host/Docker restart). Only
  // 'extra' ports (7 Days to Die, Project Zomboid) have no persisted field to fall back to, so
  // those still need the container to actually be up.
  const oldContainer = getContainer(server.containerId);
  const inspect = await oldContainer.inspect().catch(() => null);
  const hostPorts = spec.ports.map((p) => {
    if (p.purpose === 'game') return server.gamePort;
    if (p.purpose === 'rcon' && server.rconPort) return server.rconPort;

    const key = `${p.containerPort}/${p.protocol}`;
    const binding = inspect?.NetworkSettings.Ports[key]?.[0];
    if (!binding) {
      throw new ServerCreationError(`Could not find the current host port for ${key} — try starting the server first`, 500);
    }
    return Number(binding.HostPort);
  });

  await stopContainer(server.containerId);
  await removeContainer(server.containerId);

  let newContainerId: string;
  try {
    const container = await createServerContainer(spec, hostPorts, { 'outpost.serverId': server.id });
    newContainerId = container.id;
    await container.start();
  } catch (err) {
    // The old container is already gone at this point — surface clearly rather than pretending
    // the server is still fine, so the user knows to retry rather than wonder why it's offline.
    throw new ServerCreationError(
      `Resized but failed to restart the container: ${err instanceof Error ? err.message : String(err)}`,
      502,
    );
  }

  // Same reasoning as createServer(): a recreated TF2 container is back to only cp_badlands on
  // disk (see tf2.ts), so re-trigger the install + auto-switch back to whatever map it was
  // actually on, rather than silently leaving the server stuck on badlands after a resize.
  if (server.game === 'tf2' && server.variant !== 'cp_badlands') {
    startInstallingMaps(newContainerId, (ok) => {
      if (!ok) return;
      changeMap(server.game, server.rconPort, server.rconPassword, server.variant).catch(() => undefined);
    }).catch(() => undefined);
  }

  return prisma.gameServer.update({
    where: { id: serverId },
    data: {
      memoryMb,
      containerId: newContainerId,
      ...(extraSettings !== undefined ? { extraSettings: JSON.stringify(extraSettings) } : {}),
    },
  });
}
