import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { requireAuth } from '../auth/plugin.js';
import { getContainerStatus } from '../docker/containers.js';
import {
  readWorldSettings,
  updateWorldSetting,
  readGamerules,
  setGamerule,
  deleteWorld,
  GAMERULES,
  type Gamerule,
} from '../services/worldService.js';

const updateSchema = z.object({
  difficulty: z.enum(['peaceful', 'easy', 'normal', 'hard']).optional(),
  gamemode: z.enum(['survival', 'creative', 'adventure', 'spectator']).optional(),
  whitelist: z.boolean().optional(),
});

const gameruleSchema = z.object({ value: z.boolean() });

async function getMinecraftServerOr400(id: string, reply: import('fastify').FastifyReply) {
  const server = await prisma.gameServer.findUnique({ where: { id } });
  if (!server) {
    reply.code(404).send({ error: 'Server not found' });
    return null;
  }
  if (server.game !== 'minecraft') {
    reply.code(400).send({ error: 'World settings are Minecraft-only' });
    return null;
  }
  return server;
}

export async function worldRoutes(app: FastifyInstance) {
  app.get('/api/servers/:id/world', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await getMinecraftServerOr400(id, reply);
    if (!server) return;

    const settings = await readWorldSettings(server.dataPath);
    const running = server.containerId
      ? ((await getContainerStatus(server.containerId).catch(() => null))?.running ?? false)
      : false;
    const gamerules =
      running && server.rconPort && server.rconPassword
        ? await readGamerules(server.rconPort, server.rconPassword)
        : null;

    return { ...settings, running, gamerules };
  });

  app.patch('/api/servers/:id/world', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await getMinecraftServerOr400(id, reply);
    if (!server) return;

    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });

    if (parsed.data.difficulty)
      await updateWorldSetting(server.dataPath, server.rconPort, server.rconPassword, {
        difficulty: parsed.data.difficulty,
      });
    if (parsed.data.gamemode)
      await updateWorldSetting(server.dataPath, server.rconPort, server.rconPassword, {
        gamemode: parsed.data.gamemode,
      });
    if (parsed.data.whitelist !== undefined) {
      await updateWorldSetting(server.dataPath, server.rconPort, server.rconPassword, {
        whitelist: parsed.data.whitelist,
      });
    }

    return readWorldSettings(server.dataPath);
  });

  app.patch(
    '/api/servers/:id/world/gamerules/:rule',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id, rule } = request.params as { id: string; rule: string };
      const server = await getMinecraftServerOr400(id, reply);
      if (!server) return;
      if (!GAMERULES.includes(rule as Gamerule))
        return reply.code(400).send({ error: 'Unknown gamerule' });
      if (!server.rconPort || !server.rconPassword)
        return reply.code(400).send({ error: 'This server has no RCON console' });

      const parsed = gameruleSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });

      try {
        await setGamerule(
          server.rconPort,
          server.rconPassword,
          rule as Gamerule,
          parsed.data.value,
        );
        return { ok: true };
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return reply.code(502).send({ error: `Failed to reach the server console (${detail})` });
      }
    },
  );

  // Wipes the world save so the server generates a fresh one on next boot.
  app.delete('/api/servers/:id/world', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await getMinecraftServerOr400(id, reply);
    if (!server) return;

    const running = server.containerId
      ? ((await getContainerStatus(server.containerId).catch(() => null))?.running ?? false)
      : false;
    if (running)
      return reply.code(400).send({ error: 'Stop the server before deleting its world' });

    const settings = await readWorldSettings(server.dataPath);
    await deleteWorld(server.dataPath, settings.levelName);
    return { ok: true };
  });
}
