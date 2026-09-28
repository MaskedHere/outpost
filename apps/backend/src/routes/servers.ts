import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { requireAuth } from '../auth/plugin.js';
import { getGameDefinition, listGameDefinitions } from '../games/registry.js';
import {
  getContainerStatus,
  removeContainer,
  restartContainer,
  startContainer,
  stopContainer,
} from '../docker/containers.js';
import {
  createServer,
  updateServerMemory,
  ServerCreationError,
} from '../services/serverService.js';
import {
  createTunnel,
  getTunnelStatus,
  removeTunnel,
  PLAYIT_KEY_URL,
  PLAYIT_TUNNELS_URL,
} from '../services/tunnelService.js';
import {
  createBoreTunnel,
  getBoreStatus,
  pickBorePort,
  removeBoreTunnel,
} from '../services/boreService.js';
import { closePort, isPortOpen, openPort } from '../services/upnpService.js';
import { installPalworldMod, PalworldModError } from '../services/palworldModsService.js';
import { getServerReadiness } from '../services/readinessService.js';
import {
  getPlayerSummary,
  listPlayers,
  listBannedPlayers,
  listOfflineSeenPlayers,
  runPlayerAction,
  PlayersUnsupportedError,
} from '../services/playersService.js';
import { getCurrentMap, changeMap } from '../services/mapService.js';
import { isInstallingMaps, startInstallingMaps } from '../services/tf2MapsService.js';
import { getTf2MapBannerUrl } from '../services/mapBannerService.js';
import { getDirectorySizeBytes } from '../services/installProgressService.js';
import { markStopRequested, wasRecentlyStoppedByUser } from '../services/stopTrackingService.js';
import { attemptModCrashRecovery } from '../services/crashRecoveryService.js';
import { captureCacheIfEmpty } from '../services/contentCacheService.js';

const createServerSchema = z.object({
  name: z.string().min(1).max(64),
  game: z.string().default('minecraft'),
  // Optional when packId is set.
  variant: z.string().optional(),
  version: z.string().optional(),
  memoryMb: z.number().int().min(512).max(262144).default(2048),
  packId: z.string().optional(),
  workshopItemIds: z.array(z.string()).optional(),
  modIds: z.array(z.string()).optional(),
  motd: z.string().max(200).optional(),
  extraSettings: z.record(z.string(), z.string()).optional(),
  // Omitted means "whatever the global default says".
  useContentCache: z.boolean().optional(),
});

export async function serverRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // Minecraft isn't on Steam, so it gets no library_hero.jpg from that CDN.
  const BANNER_OVERRIDES: Record<string, string> = {
    minecraft: 'https://upload.wikimedia.org/wikipedia/commons/c/ca/Minecraft_-_Taiga.jpg',
  };

  app.get('/api/games', async () => {
    return listGameDefinitions().map((g) => ({
      id: g.id,
      displayName: g.displayName,
      variants: g.variants,
      variantLabels: g.variantLabels ?? null,
      variantFieldLabel: g.variantFieldLabel ?? null,
      versionLabel: g.versionLabel,
      versionPlaceholder: g.versionPlaceholder ?? null,
      moddable: g.moddable,
      moddingKind: g.moddingKind ?? null,
      workshopRequiresModIds: g.workshopRequiresModIds ?? false,
      moddedVariants: g.moddedVariants ?? [],
      // Free official artwork straight from Steam's CDN, no API key needed.
      bannerUrl: g.steamAppId
        ? `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.steamAppId}/library_hero.jpg`
        : (BANNER_OVERRIDES[g.id] ?? null),
      settings: g.settings ?? [],
      playerManagement: g.players
        ? {
            kill: Boolean(g.players.kill),
            banList: Boolean(g.players.banned),
            op: Boolean(g.players.op),
          }
        : null,
      // Value -> display label for games with live map switching (TF2)
      mapOptions: g.mapControl?.options ?? null,
      gamePortProtocol: g.gamePortProtocol,
    }));
  });

  app.get('/api/servers', async () => {
    const servers = await prisma.gameServer.findMany({
      orderBy: { createdAt: 'asc' },
      include: { pack: { include: { items: true } } },
    });
    return Promise.all(servers.map((s) => attachStatus(s)));
  });

  app.get('/api/servers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await prisma.gameServer.findUnique({
      where: { id },
      include: { pack: { include: { items: true } } },
    });
    if (!server) return reply.code(404).send({ error: 'Server not found' });

    return attachStatus(server);
  });

  // Skips everything attachStatus() does besides the raw docker stats.
  app.get('/api/servers/:id/stats', async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await prisma.gameServer.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: 'Server not found' });
    if (!server.containerId)
      return { running: false, cpuPercent: 0, memoryUsedMb: 0, memoryLimitMb: 0 };

    const status = await getContainerStatus(server.containerId).catch(() => null);
    return {
      running: status?.running ?? false,
      cpuPercent: status?.cpuPercent ?? 0,
      memoryUsedMb: status?.memoryUsedMb ?? 0,
      memoryLimitMb: status?.memoryLimitMb ?? 0,
    };
  });

  app.post('/api/servers', async (request, reply) => {
    const parsed = createServerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
    }

    try {
      const settings = await prisma.settings.findUnique({ where: { id: 'default' } });
      const server = await createServer({
        ...parsed.data,
        useContentCache: parsed.data.useContentCache ?? settings?.useGameCache ?? true,
      });
      return reply.code(201).send(server);
    } catch (err) {
      if (err instanceof ServerCreationError) {
        return reply.code(err.statusCode).send({ error: err.message });
      }
      app.log.error(err);
      return reply.code(500).send({ error: 'Failed to create game server' });
    }
  });

  const updateMemorySchema = z.object({ memoryMb: z.number().int().min(512).max(262144) });

  // Stops and recreates the container with the new memory limit (a live `docker update` isn't
  // enough for games like Minecraft; see updateServerMemory).
  app.patch('/api/servers/:id/memory', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateMemorySchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });

    try {
      const server = await updateServerMemory(id, parsed.data.memoryMb);
      return server;
    } catch (err) {
      if (err instanceof ServerCreationError) {
        return reply.code(err.statusCode).send({ error: err.message });
      }
      app.log.error(err);
      return reply.code(500).send({ error: 'Failed to change memory limit' });
    }
  });

  const updateSettingsSchema = z.object({ extraSettings: z.record(z.string(), z.string()) });

  // Same rebuild-the-container mechanism as /memory.
  app.patch('/api/servers/:id/settings', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateSettingsSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });

    const existing = await prisma.gameServer.findUnique({
      where: { id },
      select: { memoryMb: true },
    });
    if (!existing) return reply.code(404).send({ error: 'Server not found' });

    try {
      const server = await updateServerMemory(id, existing.memoryMb, parsed.data.extraSettings);
      return server;
    } catch (err) {
      if (err instanceof ServerCreationError) {
        return reply.code(err.statusCode).send({ error: err.message });
      }
      app.log.error(err);
      return reply.code(500).send({ error: 'Failed to change server settings' });
    }
  });

  app.post('/api/servers/:id/start', async (request, reply) => {
    const server = await getServerOr404(request.params as { id: string }, reply);
    if (!server) return;
    await startContainer(server.containerId!);
    return { ok: true };
  });

  app.post('/api/servers/:id/stop', async (request, reply) => {
    const server = await getServerOr404(request.params as { id: string }, reply);
    if (!server) return;
    markStopRequested(server.id);
    await stopContainer(server.containerId!);
    return { ok: true };
  });

  app.post('/api/servers/:id/restart', async (request, reply) => {
    const server = await getServerOr404(request.params as { id: string }, reply);
    if (!server) return;
    markStopRequested(server.id);
    await restartContainer(server.containerId!);
    return { ok: true };
  });

  app.get('/api/servers/:id/players', async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await prisma.gameServer.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: 'Server not found' });
    try {
      return {
        players: await listPlayers(
          server.game,
          server.id,
          server.rconPort,
          server.rconPassword,
          server.dataPath,
        ),
      };
    } catch (err) {
      if (err instanceof PlayersUnsupportedError)
        return reply.code(400).send({ error: err.message });
      app.log.error(err);
      const detail = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: `Failed to reach the server console (${detail})` });
    }
  });

  app.get('/api/servers/:id/players/banned', async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await prisma.gameServer.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: 'Server not found' });
    try {
      return {
        players: await listBannedPlayers(server.game, server.rconPort, server.rconPassword),
      };
    } catch (err) {
      if (err instanceof PlayersUnsupportedError)
        return reply.code(400).send({ error: err.message });
      app.log.error(err);
      const detail = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: `Failed to reach the server console (${detail})` });
    }
  });

  // Players RCON has seen connect before but aren't online (or banned) right now.
  app.get('/api/servers/:id/players/offline', async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await prisma.gameServer.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: 'Server not found' });
    try {
      return {
        players: await listOfflineSeenPlayers(
          server.game,
          server.id,
          server.rconPort,
          server.rconPassword,
        ),
      };
    } catch (err) {
      if (err instanceof PlayersUnsupportedError)
        return reply.code(400).send({ error: err.message });
      app.log.error(err);
      return reply.code(500).send({ error: 'Failed to load the offline player log' });
    }
  });

  const playerActionSchema = z.object({
    action: z.enum(['kick', 'ban', 'kill', 'unban', 'op', 'deop']),
    player: z.object({ name: z.string().min(1), id: z.string().min(1) }),
  });

  app.post('/api/servers/:id/players/action', async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await prisma.gameServer.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: 'Server not found' });

    const parsed = playerActionSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });

    try {
      await runPlayerAction(
        server.game,
        server.rconPort,
        server.rconPassword,
        parsed.data.action,
        parsed.data.player,
      );
      return { ok: true };
    } catch (err) {
      if (err instanceof PlayersUnsupportedError)
        return reply.code(400).send({ error: err.message });
      app.log.error(err);
      return reply
        .code(502)
        .send({ error: 'Failed to run that action — check the server console' });
    }
  });

  // Live map switching over RCON, so the change applies in seconds without recreating the
  // container.
  app.get('/api/servers/:id/map', async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await prisma.gameServer.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: 'Server not found' });

    const mapControl = getGameDefinition(server.game).mapControl;
    if (!mapControl)
      return { supported: false, options: null, current: null, installingExtraMaps: false };

    const current = await getCurrentMap(server.game, server.rconPort, server.rconPassword);
    const installingExtraMaps =
      server.game === 'tf2' && !!server.containerId && isInstallingMaps(server.containerId);
    return { supported: true, options: mapControl.options, current, installingExtraMaps };
  });

  // TF2-only: the image ships with just one map to stay small (see tf2MapsService.ts)
  app.post('/api/servers/:id/map/install-extra', async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await prisma.gameServer.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: 'Server not found' });
    if (server.game !== 'tf2' || !server.containerId) {
      return reply.code(400).send({ error: 'This game has no extra maps to install' });
    }

    await startInstallingMaps(server.containerId);
    return { ok: true };
  });

  const changeMapSchema = z.object({ map: z.string().min(1) });

  app.post('/api/servers/:id/map', async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await prisma.gameServer.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: 'Server not found' });

    const parsed = changeMapSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });

    try {
      await changeMap(server.game, server.rconPort, server.rconPassword, parsed.data.map);
      return { ok: true };
    } catch (err) {
      if (err instanceof PlayersUnsupportedError)
        return reply.code(400).send({ error: err.message });
      app.log.error(err);
      return reply.code(502).send({ error: 'Failed to change the map — check the server console' });
    }
  });

  // Public access via a playit.gg tunnel.
  app.get('/api/servers/:id/tunnel', async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await prisma.gameServer.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: 'Server not found' });
    if (!server.tunnelContainerId) {
      return {
        enabled: false,
        keyUrl: PLAYIT_KEY_URL,
        tunnelsUrl: PLAYIT_TUNNELS_URL,
        gamePort: server.gamePort,
      };
    }
    const status = await getTunnelStatus(server.tunnelContainerId);
    return {
      enabled: true,
      ...status,
      keyUrl: PLAYIT_KEY_URL,
      tunnelsUrl: PLAYIT_TUNNELS_URL,
      gamePort: server.gamePort,
    };
  });

  app.post('/api/servers/:id/tunnel', async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await prisma.gameServer.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: 'Server not found' });
    if (server.tunnelContainerId) return reply.code(400).send({ error: 'Tunnel already enabled' });

    const parsed = z.object({ secretKey: z.string().min(10) }).safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'A playit.gg secret key is required' });

    try {
      const containerId = await createTunnel(`outpost-tunnel-${id}`, parsed.data.secretKey);
      await prisma.gameServer.update({
        where: { id },
        data: { tunnelContainerId: containerId, tunnelSecretKey: parsed.data.secretKey },
      });
      return reply.code(201).send({ enabled: true });
    } catch (err) {
      app.log.error(err);
      return reply
        .code(502)
        .send({ error: 'Failed to start the tunnel — check your secret key and try again' });
    }
  });

  app.delete('/api/servers/:id/tunnel', async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await prisma.gameServer.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: 'Server not found' });
    if (server.tunnelContainerId) await removeTunnel(server.tunnelContainerId);
    await prisma.gameServer.update({
      where: { id },
      data: { tunnelContainerId: null, tunnelSecretKey: null },
    });
    return { ok: true };
  });

  // Alternative public access via bore.pub.
  app.get('/api/servers/:id/bore', async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await prisma.gameServer.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: 'Server not found' });
    const supported = getGameDefinition(server.game).gamePortProtocol === 'tcp';
    if (!server.boreContainerId) {
      return { enabled: false, supported, gamePort: server.gamePort };
    }
    const status = await getBoreStatus(server.boreContainerId);
    return {
      enabled: true,
      ...status,
      supported,
      gamePort: server.gamePort,
      borePort: server.borePort,
    };
  });

  app.post('/api/servers/:id/bore', async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await prisma.gameServer.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: 'Server not found' });
    if (server.boreContainerId) return reply.code(400).send({ error: 'Tunnel already enabled' });
    if (getGameDefinition(server.game).gamePortProtocol !== 'tcp') {
      return reply.code(400).send({
        error: 'This game uses a UDP game port, which bore cannot tunnel — use playit.gg instead',
      });
    }

    const borePort = pickBorePort();
    try {
      const containerId = await createBoreTunnel(`outpost-bore-${id}`, server.gamePort, borePort);
      await prisma.gameServer.update({
        where: { id },
        data: { boreContainerId: containerId, borePort },
      });
      return reply.code(201).send({ enabled: true, borePort });
    } catch (err) {
      app.log.error(err);
      return reply.code(502).send({ error: 'Failed to start the tunnel — try again' });
    }
  });

  app.delete('/api/servers/:id/bore', async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await prisma.gameServer.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: 'Server not found' });
    if (server.boreContainerId) await removeBoreTunnel(server.boreContainerId);
    await prisma.gameServer.update({
      where: { id },
      data: { boreContainerId: null, borePort: null },
    });
    return { ok: true };
  });

  // Installs a CurseForge Palworld mod straight into this server's files.
  app.post('/api/servers/:id/palworld-mods', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { slug?: string; fileId?: number; category?: string };
    if (!body.slug || !body.fileId || !body.category) {
      return reply.code(400).send({ error: 'slug, fileId, and category are required' });
    }

    const server = await prisma.gameServer.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: 'Server not found' });
    if (server.game !== 'palworld')
      return reply.code(400).send({ error: 'This server is not a Palworld server' });

    try {
      const result = await installPalworldMod(
        server.dataPath,
        body.slug,
        body.fileId,
        body.category,
      );
      return { ok: true, ...result };
    } catch (err) {
      if (err instanceof PalworldModError) return reply.code(400).send({ error: err.message });
      app.log.error(err);
      return reply.code(502).send({ error: 'Failed to install this mod' });
    }
  });

  // Direct router port forwarding over UPnP.
  app.get('/api/servers/:id/upnp', async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await prisma.gameServer.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: 'Server not found' });
    const protocol = getGameDefinition(server.game).gamePortProtocol;
    const status = await isPortOpen(server.gamePort, protocol).catch(() => null);
    if (!status)
      return {
        supported: false,
        mapped: false,
        externalIp: null,
        gamePort: server.gamePort,
        protocol,
        output: '',
      };
    return {
      supported: status.ok,
      mapped: status.mapped,
      externalIp: status.externalIp,
      gamePort: server.gamePort,
      protocol,
      output: status.output,
    };
  });

  app.post('/api/servers/:id/upnp', async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await prisma.gameServer.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: 'Server not found' });
    const protocol = getGameDefinition(server.game).gamePortProtocol;
    const result = await openPort(server.gamePort, protocol).catch(() => null);
    if (!result?.ok) {
      // Surface what the router said.
      return reply.code(502).send({
        error:
          'The router did not accept the port forward. Most often UPnP is turned off in its settings.',
        output: result?.output ?? '',
      });
    }
    return { ok: true, externalIp: result.externalIp, gamePort: server.gamePort, protocol };
  });

  app.delete('/api/servers/:id/upnp', async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await prisma.gameServer.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: 'Server not found' });
    const protocol = getGameDefinition(server.game).gamePortProtocol;
    await closePort(server.gamePort, protocol).catch(() => undefined);
    return { ok: true };
  });

  app.delete('/api/servers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleteData = (request.query as { deleteData?: string }).deleteData === 'true';
    const server = await prisma.gameServer.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: 'Server not found' });

    if (server.containerId) {
      await removeContainer(server.containerId);
    }
    if (server.tunnelContainerId) {
      await removeTunnel(server.tunnelContainerId);
    }
    if (server.boreContainerId) {
      await removeBoreTunnel(server.boreContainerId);
    }
    if (deleteData) {
      await fs.rm(server.dataPath, { recursive: true, force: true });
    }
    await prisma.gameServer.delete({ where: { id } });
    return { ok: true };
  });
}

async function attachStatus<
  T extends {
    id: string;
    containerId: string | null;
    game: string;
    gamePort: number;
    rconPort: number | null;
    rconPassword: string | null;
    dataPath: string;
    pack?: { items: { fileSizeBytes: number; localFilePath: string | null }[] } | null;
  },
>(server: T) {
  const status = server.containerId
    ? await getContainerStatus(server.containerId).catch(() => null)
    : null;
  const readinessResult = await getServerReadiness(
    server.game,
    server.containerId ?? '',
    status?.running ?? false,
    status?.startedAt ?? null,
    server.gamePort,
    server.rconPort,
    server.rconPassword,
    {
      restartCount: status?.restartCount ?? 0,
      exitCode: status?.exitCode ?? null,
      oomKilled: status?.oomKilled ?? false,
      deliberateStop: wasRecentlyStoppedByUser(server.id),
    },
  );

  // If Forge's crash report names the mod that broke the boot, quarantine it and restart
  // automatically (see crashRecoveryService).
  let autoRecoveredMods: string[] | null = null;
  if (readinessResult.readiness !== 'running' && server.containerId) {
    const recovery = await attemptModCrashRecovery(
      server.id,
      server.containerId,
      server.dataPath,
    ).catch(() => null);
    if (recovery) autoRecoveredMods = recovery.removedMods;
  }
  const readiness = autoRecoveredMods ? 'booting' : readinessResult.readiness;
  const installPhase = autoRecoveredMods ? null : readinessResult.installPhase;

  // Capture only a *confirmed* running server into the shared cache. Plain `readiness ===
  // 'running'` can come from the grace-period fallback, and caching a broken install would spread
  // it to every new server.
  if (readiness === 'running' && readinessResult.confirmed)
    captureCacheIfEmpty(server.game, server.dataPath);

  const players =
    readiness === 'running'
      ? await getPlayerSummary(server.game, server.id, server.rconPort, server.rconPassword)
      : null;

  // Only TF2 has both mapControl and a wiki to look art up on right now (see mapBannerService.ts)
  const mapOptionLabel =
    server.game === 'tf2' && players?.map
      ? getGameDefinition(server.game).mapControl?.options[players.map]
      : undefined;
  const mapBannerUrl =
    players?.map && mapOptionLabel
      ? await getTf2MapBannerUrl(players.map, mapOptionLabel).catch(() => null)
      : null;

  // A byte count is only meaningful during installPhase 'mods'.
  const liveDownloadItems = server.pack?.items.filter((item) => !item.localFilePath) ?? [];
  const trackingLiveDownload =
    readiness === 'installing' && installPhase === 'mods' && liveDownloadItems.length > 0;

  const installBytes = trackingLiveDownload
    ? await getDirectorySizeBytes(path.join(server.dataPath, 'mods')).catch(() => null)
    : null;
  const installTotalBytes = trackingLiveDownload
    ? liveDownloadItems.reduce((sum, item) => sum + item.fileSizeBytes, 0) || null
    : null;

  return {
    ...server,
    status,
    readiness,
    installPhase,
    players,
    mapBannerUrl,
    installBytes,
    installTotalBytes,
    autoRecoveredMods,
  };
}

async function getServerOr404(params: { id: string }, reply: import('fastify').FastifyReply) {
  const server = await prisma.gameServer.findUnique({ where: { id: params.id } });
  if (!server || !server.containerId) {
    reply.code(404).send({ error: 'Server not found' });
    return null;
  }
  return server;
}
