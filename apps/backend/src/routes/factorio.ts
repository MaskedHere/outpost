import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/plugin.js';
import {
  searchFactorioMods,
  getFactorioModDependencies,
  FACTORIO_CATEGORIES,
} from '../factorio/modPortal.js';

export async function factorioRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/factorio/categories', async () => ({ categories: FACTORIO_CATEGORIES }));

  app.get('/api/factorio/mods', async (request, reply) => {
    const query = request.query as { q?: string; category?: string; offset?: string };
    try {
      return await searchFactorioMods({
        query: query.q ?? '',
        category: query.category || undefined,
        offset: query.offset ? Number(query.offset) : 0,
      });
    } catch (err) {
      app.log.error(err);
      return reply.code(502).send({ error: 'Could not reach the Factorio mod portal.' });
    }
  });

  app.get('/api/factorio/mods/:name/dependencies', async (request, reply) => {
    const { name } = request.params as { name: string };
    try {
      return { dependencies: await getFactorioModDependencies(name) };
    } catch (err) {
      app.log.error(err);
      return reply.code(502).send({ error: 'Could not read this mod’s dependencies.' });
    }
  });
}
