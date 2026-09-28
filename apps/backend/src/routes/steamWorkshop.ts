import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/plugin.js';
import { fetchCollectionChildren, fetchItemDetails, extractModIds } from '../steam/workshop.js';

export async function steamWorkshopRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // Resolves a Steam Workshop collection into the same {workshopItemIds, modIds} shape the manual
  // Project Zomboid fields already take.
  app.post('/api/steam-workshop/resolve-collection', async (request, reply) => {
    const body = (request.body ?? {}) as { collectionId?: string };
    const collectionId = body.collectionId?.trim();
    if (!collectionId || !/^\d+$/.test(collectionId)) {
      return reply.code(400).send({ error: 'Enter a numeric Steam Workshop collection ID' });
    }

    try {
      const childIds = await fetchCollectionChildren(collectionId);
      if (childIds.length === 0) return reply.code(400).send({ error: 'This collection is empty' });

      const details = await fetchItemDetails(childIds);

      const workshopItemIds: string[] = [];
      const modIds: string[] = [];
      const unresolved: { workshopId: string; title: string }[] = [];

      for (const item of details) {
        const found = extractModIds(item.description);
        if (found.length === 0) {
          unresolved.push({
            workshopId: item.workshopItemId,
            title: item.title || item.workshopItemId,
          });
          continue;
        }
        // Both lists have to stay position-matched 1:1 (see projectzomboid.ts's buildContainerSpec)
        for (const modId of found) {
          workshopItemIds.push(item.workshopItemId);
          modIds.push(modId);
        }
      }

      return { workshopItemIds, modIds, unresolved, total: details.length };
    } catch (err) {
      app.log.error(err);
      return reply
        .code(502)
        .send({ error: err instanceof Error ? err.message : 'Failed to resolve collection' });
    }
  });
}
