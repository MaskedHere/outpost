import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { requireAuth } from '../auth/plugin.js';
import { getGameDefinition, listGameDefinitions } from '../games/registry.js';
import {
  searchWorkshop,
  fetchItemDetails,
  fetchCollectionChildren,
  extractModIds,
} from '../steam/workshop.js';

/** Which Workshop a game's mods live in. */
function workshopAppIdFor(gameId: string): number {
  const def = getGameDefinition(gameId);
  const appId = def.workshopAppId ?? def.steamAppId;
  if (!def.moddingKind?.startsWith('workshop') || !appId) {
    throw new Error(`${def.displayName} doesn't use the Steam Workshop`);
  }
  return appId;
}

/** Zomboid is the only game that needs a second identifier per item. */
function needsModIds(gameId: string): boolean {
  return getGameDefinition(gameId).workshopRequiresModIds === true;
}

const createSchema = z.object({
  name: z.string().min(1, 'Give the pack a name'),
  game: z.string().min(1),
});

const addItemSchema = z.object({
  workshopItemId: z.string().regex(/^\d+$/, 'Workshop item IDs are numeric'),
});

export async function workshopPackRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  /** The games this feature applies to at all, so the UI can offer exactly those and no others. */
  app.get('/api/workshop-games', async () => ({
    games: listGameDefinitions()
      .filter((d) => d.moddingKind?.startsWith('workshop') && (d.workshopAppId ?? d.steamAppId))
      .map((d) => ({
        id: d.id,
        displayName: d.displayName,
        requiresModIds: d.workshopRequiresModIds === true,
      })),
  }));

  app.get('/api/workshop-packs', async () => {
    return prisma.workshopPack.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { items: true } } },
    });
  });

  app.post('/api/workshop-packs', async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
    try {
      workshopAppIdFor(parsed.data.game);
    } catch (err) {
      return reply
        .code(400)
        .send({ error: err instanceof Error ? err.message : 'Unsupported game' });
    }
    return prisma.workshopPack.create({ data: parsed.data, include: { items: true } });
  });

  app.get('/api/workshop-packs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const pack = await prisma.workshopPack.findUnique({
      where: { id },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
    if (!pack) return reply.code(404).send({ error: 'Pack not found' });
    return pack;
  });

  app.delete('/api/workshop-packs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.workshopPack.delete({ where: { id } }).catch(() => null);
    return reply.code(204).send();
  });

  /** Searches the Workshop of whichever game this pack targets. */
  app.get('/api/workshop-packs/:id/search', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { q, page, sort } = request.query as { q?: string; page?: string; sort?: string };
    const pack = await prisma.workshopPack.findUnique({ where: { id } });
    if (!pack) return reply.code(404).send({ error: 'Pack not found' });

    try {
      const hits = await searchWorkshop({
        appId: workshopAppIdFor(pack.game),
        query: q ?? '',
        page: page ? Number(page) : 1,
        sort,
      });
      return { hits };
    } catch (err) {
      app.log.error(err);
      return reply.code(502).send({ error: 'Failed to search the Steam Workshop' });
    }
  });

  app.post('/api/workshop-packs/:id/items', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = addItemSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });

    const pack = await prisma.workshopPack.findUnique({ where: { id }, include: { items: true } });
    if (!pack) return reply.code(404).send({ error: 'Pack not found' });
    if (pack.items.some((i) => i.workshopItemId === parsed.data.workshopItemId)) {
      return reply.code(409).send({ error: 'That item is already in this pack' });
    }

    const [detail] = await fetchItemDetails([parsed.data.workshopItemId]).catch(() => []);
    if (!detail)
      return reply
        .code(404)
        .send({ error: "Steam doesn't know that Workshop item — check the ID" });

    // One row per mod id so a multi-mod Workshop item stays aligned with Zomboid's position-matched
    // lists.
    const modIds = needsModIds(pack.game) ? extractModIds(detail.description) : [];
    const rows = modIds.length > 0 ? modIds : [null];
    await prisma.workshopPackItem.createMany({
      data: rows.map((modId) => ({
        packId: id,
        workshopItemId: detail.workshopItemId,
        title: detail.title || detail.workshopItemId,
        modId,
        previewUrl: detail.previewUrl,
      })),
    });

    return prisma.workshopPack.findUnique({
      where: { id },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
  });

  /** Lets a Zomboid item whose author didn't publish a Mod ID in the usual format be fixed by hand
   *  rather than leaving it silently broken. */
  app.patch('/api/workshop-packs/:id/items/:itemId', async (request, reply) => {
    const { id, itemId } = request.params as { id: string; itemId: string };
    const body = (request.body ?? {}) as { modId?: string | null };
    const modId = body.modId?.trim() || null;
    if (modId && !/^[A-Za-z0-9_.-]{1,64}$/.test(modId)) {
      return reply.code(400).send({ error: 'That does not look like a Mod ID' });
    }
    await prisma.workshopPackItem
      .update({ where: { id: itemId }, data: { modId } })
      .catch(() => null);
    return prisma.workshopPack.findUnique({
      where: { id },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
  });

  app.delete('/api/workshop-packs/:id/items/:itemId', async (request, reply) => {
    const { id, itemId } = request.params as { id: string; itemId: string };
    await prisma.workshopPackItem.delete({ where: { id: itemId } }).catch(() => null);
    return prisma.workshopPack.findUnique({
      where: { id },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
  });

  /** Seeds a pack from an existing Steam collection, so an established collection is a starting
   *  point rather than something to retype. */
  app.post('/api/workshop-packs/:id/import-collection', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { collectionId?: string };
    const collectionId = body.collectionId?.trim();
    if (!collectionId || !/^\d+$/.test(collectionId)) {
      return reply.code(400).send({ error: 'Enter a numeric Steam Workshop collection ID' });
    }

    const pack = await prisma.workshopPack.findUnique({ where: { id }, include: { items: true } });
    if (!pack) return reply.code(404).send({ error: 'Pack not found' });

    try {
      const childIds = await fetchCollectionChildren(collectionId);
      if (childIds.length === 0) return reply.code(400).send({ error: 'This collection is empty' });

      const existing = new Set(pack.items.map((i) => i.workshopItemId));
      const details = await fetchItemDetails(childIds.filter((c) => !existing.has(c)));
      const wantModIds = needsModIds(pack.game);

      const data: {
        packId: string;
        workshopItemId: string;
        title: string;
        modId: string | null;
        previewUrl: string | null;
      }[] = [];
      const unresolved: { workshopItemId: string; title: string }[] = [];

      for (const detail of details) {
        const modIds = wantModIds ? extractModIds(detail.description) : [];
        if (wantModIds && modIds.length === 0) {
          unresolved.push({
            workshopItemId: detail.workshopItemId,
            title: detail.title || detail.workshopItemId,
          });
        }
        for (const modId of modIds.length > 0 ? modIds : [null]) {
          data.push({
            packId: id,
            workshopItemId: detail.workshopItemId,
            title: detail.title || detail.workshopItemId,
            modId,
            previewUrl: detail.previewUrl,
          });
        }
      }

      await prisma.workshopPackItem.createMany({ data });
      const updated = await prisma.workshopPack.findUnique({
        where: { id },
        include: { items: { orderBy: { createdAt: 'asc' } } },
      });
      // `unresolved` items are still added, just without a Mod ID, so the UI can prompt for one.
      return { pack: updated, imported: data.length, unresolved };
    } catch (err) {
      app.log.error(err);
      return reply
        .code(502)
        .send({ error: err instanceof Error ? err.message : 'Failed to import collection' });
    }
  });
}
