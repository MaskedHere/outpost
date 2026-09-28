import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/plugin.js';
import {
  listCaches,
  startPrewarm,
  deleteCache,
  isCacheBusy,
} from '../services/contentCacheService.js';

export async function contentCacheRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/game-cache', async () => {
    return { games: await listCaches() };
  });

  app.post('/api/game-cache/:gameId/prewarm', async (request, reply) => {
    const { gameId } = request.params as { gameId: string };
    if (isCacheBusy(gameId))
      return reply.code(409).send({ error: 'This game is already downloading' });
    startPrewarm(gameId);
    return { started: true };
  });

  app.delete('/api/game-cache/:gameId', async (request, reply) => {
    const { gameId } = request.params as { gameId: string };
    if (isCacheBusy(gameId))
      return reply.code(409).send({ error: "Can't delete this while it's still downloading" });
    await deleteCache(gameId);
    return { ok: true };
  });
}
