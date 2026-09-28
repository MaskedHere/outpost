import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { prisma } from '../db/client.js';
import type { PackItem } from '../../generated/prisma/index.js';
import { config } from '../config.js';
import { getGameDefinition } from '../games/registry.js';
import {
  createServerContainer,
  getContainer,
  removeContainer,
  stopContainer,
} from '../docker/containers.js';
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

/**
 * Deploy method depends on localFilePath, not PackItem.source: items with a stored file are copied
 * into the mods folder (see copyLocalPackItems); the rest are fetched from Modrinth's CDN via
 * MODRINTH_PROJECTS.
 */
function modrinthOnly(
  items: { projectId: string | null; versionId: string | null; localFilePath: string | null }[],
) {
  return items
    .filter((item) => item.projectId && item.versionId && !item.localFilePath)
    .map((item) => ({ projectId: item.projectId!, versionId: item.versionId! }));
}

async function copyLocalPackItems(
  dataPath: string,
  items: { localFilePath: string | null; filename: string }[],
) {
  const localItems = items.filter((item) => item.localFilePath);
  if (localItems.length === 0) return;
  const modsDir = path.join(dataPath, 'mods');
  await fs.mkdir(modsDir, { recursive: true });
  await Promise.all(
    localItems.map((item) =>
      fs.copyFile(
        path.join(config.packsDir, item.localFilePath!),
        path.join(modsDir, item.filename),
      ),
    ),
  );
}

/**
 * Mirrors a CurseForge pack's stored overrides/ folder (configs, resourcepacks, scripts - see
 * modpacks.ts's persistOverrideFiles) directly into the new server's dataPath, same relative layout
 * (overrides/config/x.toml -> dataPath/config/x.toml).
 */
async function copyPackOverrides(dataPath: string, packId: string) {
  const overridesDir = path.join(config.packsDir, packId, 'overrides');
  const entries = await fs
    .readdir(overridesDir, { withFileTypes: true, recursive: true })
    .catch(() => []);
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
  workshopItemIds?: string[];
  modIds?: string[];
  motd?: string;
  extraSettings?: Record<string, string>;
  /**
   * Seed this server from the shared game-content cache instead of letting it download the whole
   * game from Steam again (see contentCacheService).
   */
  useContentCache?: boolean;
}

export async function createServer(input: CreateServerInput) {
  let variant = input.variant ?? '';
  let version = input.version ?? '';
  let modrinthMods: { projectId: string; versionId: string }[] = [];
  let packItems: PackItem[] | null = null;
  const game = input.packId ? 'minecraft' : (input.game ?? 'minecraft');

  if (input.packId) {
    const pack = await prisma.pack.findUnique({
      where: { id: input.packId },
      include: { items: true },
    });
    if (!pack) throw new ServerCreationError('Pack not found', 404);
    variant = pack.loader;
    version = pack.mcVersion;
    modrinthMods = modrinthOnly(pack.items);
    packItems = pack.items;
  }

  const gameDef = getGameDefinition(game);
  if (!gameDef.variants.includes(variant)) {
    throw new ServerCreationError(
      `Unsupported variant for ${gameDef.displayName}: ${variant}`,
      400,
    );
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
    workshopItemIds: input.workshopItemIds,
    modIds: input.modIds,
    motd: input.motd,
    extraSettings: input.extraSettings,
  });

  // Seed game files from the shared cache before the container starts, so SteamCMD only verifies
  // instead of re-downloading. Wrapping preCreate runs this after the volume directories exist but
  // before any game writes its own per-server files.
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
  if (gamePortIndex === -1)
    throw new Error(`${gameDef.displayName} container spec has no 'game' port`);

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
      // Stored even without an RCON port: some games (Valheim) reuse it as the join password.
      rconPassword,
      memoryMb: input.memoryMb,
      dataPath,
      packId: input.packId ?? null,
      motd: input.motd ?? null,
      workshopItemIds: input.workshopItemIds ? JSON.stringify(input.workshopItemIds) : null,
      modIds: input.modIds ? JSON.stringify(input.modIds) : null,
      extraSettings: input.extraSettings ? JSON.stringify(input.extraSettings) : null,
    },
  });

  // TF2 always boots on cp_badlands (the only map baked into the base image - see tf2.ts) since
  // every other stock map needs a one-time steamcmd validate pass to exist on disk at all.
  if (game === 'tf2' && variant !== 'cp_badlands') {
    startInstallingMaps(containerId, (ok) => {
      if (!ok) return;
      changeMap(game, rconPort, rconPassword, variant).catch(() => undefined);
    }).catch(() => undefined);
  }

  return created;
}

/**
 * Docker has no way to change an existing container's env vars (e.g. Minecraft's JVM heap comes
 * from a MEMORY env var baked in at creation), so the only correct way to change memory after the
 * fact is to rebuild the container from the exact same spec with the new value.
 */
export async function updateServerMemory(
  serverId: string,
  memoryMb: number,
  extraSettings?: Record<string, string>,
) {
  const server = await prisma.gameServer.findUnique({
    where: { id: serverId },
    include: { pack: { include: { items: true } }, plugins: true },
  });
  if (!server) throw new ServerCreationError('Server not found', 404);
  if (!server.containerId) throw new ServerCreationError('Server has no container to resize', 400);

  const gameDef = getGameDefinition(server.game);
  // Mods (from an attached Pack) and plugins (per-server, Paper-only) both ride on the same
  // MODRINTH_PROJECTS mechanism.
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
    workshopItemIds: server.workshopItemIds ? JSON.parse(server.workshopItemIds) : undefined,
    modIds: server.modIds ? JSON.parse(server.modIds) : undefined,
    motd: server.motd ?? undefined,
    extraSettings:
      extraSettings ?? (server.extraSettings ? JSON.parse(server.extraSettings) : undefined),
  });

  // 'game' and 'rcon' host ports are already durably recorded on the server row itself.
  const oldContainer = getContainer(server.containerId);
  const inspect = await oldContainer.inspect().catch(() => null);
  const hostPorts = spec.ports.map((p) => {
    if (p.purpose === 'game') return server.gamePort;
    if (p.purpose === 'rcon' && server.rconPort) return server.rconPort;

    const key = `${p.containerPort}/${p.protocol}`;
    const binding = inspect?.NetworkSettings.Ports[key]?.[0];
    if (!binding) {
      throw new ServerCreationError(
        `Could not find the current host port for ${key} — try starting the server first`,
        500,
      );
    }
    return Number(binding.HostPort);
  });

  await stopContainer(server.containerId);
  await removeContainer(server.containerId);

  let newContainerId: string;
  try {
    const container = await createServerContainer(spec, hostPorts, {
      'outpost.serverId': server.id,
    });
    newContainerId = container.id;
    await container.start();
  } catch (err) {
    // The old container is already gone at this point.
    throw new ServerCreationError(
      `Resized but failed to restart the container: ${err instanceof Error ? err.message : String(err)}`,
      502,
    );
  }

  // Same reasoning as createServer(): a recreated TF2 container is back to only cp_badlands on disk
  // (see tf2.ts), so re-trigger the install + auto-switch back to whatever map it was on, rather
  // than silently leaving the server stuck on badlands after a resize.
  if (server.game === 'tf2' && server.variant !== 'cp_badlands') {
    startInstallingMaps(newContainerId, (ok) => {
      if (!ok) return;
      changeMap(server.game, server.rconPort, server.rconPassword, server.variant).catch(
        () => undefined,
      );
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
