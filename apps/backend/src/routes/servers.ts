import fs from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { requireAuth } from '../auth/plugin.js';
import { listGameDefinitions } from '../games/registry.js';
import { getContainerStatus, removeContainer, restartContainer, startContainer, stopContainer } from '../docker/containers.js';
import { createServer, ServerCreationError } from '../services/serverService.js';

const createServerSchema = z.object({
  name: z.string().min(1).max(64),
  loader: z.string(),
  mcVersion: z.string(),
  memoryMb: z.number().int().min(512).max(32768).default(2048),
  packId: z.string().optional(),
});

export async function serverRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/games', async () => {
    return listGameDefinitions().map((g) => ({
      id: g.id,
      displayName: g.displayName,
      loaders: g.loaders,
      defaultGamePort: g.defaultGamePort,
    }));
  });

  app.get('/api/servers', async () => {
    const servers = await prisma.gameServer.findMany({ orderBy: { createdAt: 'asc' } });
    return Promise.all(
      servers.map(async (s) => ({
        ...s,
        status: s.containerId
          ? await getContainerStatus(s.containerId).catch(() => null)
          : null,
      })),
    );
  });

  app.get('/api/servers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await prisma.gameServer.findUnique({ where: { id }, include: { pack: { include: { items: true } } } });
    if (!server) return reply.code(404).send({ error: 'Server not found' });

    const status = server.containerId ? await getContainerStatus(server.containerId).catch(() => null) : null;
    return { ...server, status };
  });

  app.post('/api/servers', async (request, reply) => {
    const parsed = createServerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
    }

    try {
      const server = await createServer(parsed.data);
      return reply.code(201).send(server);
    } catch (err) {
      if (err instanceof ServerCreationError) {
        return reply.code(err.statusCode).send({ error: err.message });
      }
      app.log.error(err);
      return reply.code(500).send({ error: 'Failed to create game server' });
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
    await stopContainer(server.containerId!);
    return { ok: true };
  });

  app.post('/api/servers/:id/restart', async (request, reply) => {
    const server = await getServerOr404(request.params as { id: string }, reply);
    if (!server) return;
    await restartContainer(server.containerId!);
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
    if (deleteData) {
      await fs.rm(server.dataPath, { recursive: true, force: true });
    }
    await prisma.gameServer.delete({ where: { id } });
    return { ok: true };
  });
}

async function getServerOr404(params: { id: string }, reply: import('fastify').FastifyReply) {
  const server = await prisma.gameServer.findUnique({ where: { id: params.id } });
  if (!server || !server.containerId) {
    reply.code(404).send({ error: 'Server not found' });
    return null;
  }
  return server;
}
