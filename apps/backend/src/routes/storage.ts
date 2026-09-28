import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/plugin.js';
import {
  listOrphans,
  deleteOrphan,
  restoreOrphan,
  OrphanRestoreError,
} from '../services/orphanService.js';

const restoreSchema = z.object({
  game: z.string().min(1),
  name: z.string().min(1).max(64),
  variant: z.string().optional(),
  version: z.string().optional(),
  memoryMb: z.number().int().min(512).max(262144),
});

export async function storageRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/storage/orphans', async () => {
    const orphans = await listOrphans();
    return { orphans, totalBytes: orphans.reduce((sum, o) => sum + o.sizeBytes, 0) };
  });

  app.post('/api/storage/orphans/:id/restore', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = restoreSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
    try {
      return await restoreOrphan({ id, ...parsed.data });
    } catch (err) {
      if (err instanceof OrphanRestoreError) return reply.code(400).send({ error: err.message });
      app.log.error(err);
      return reply.code(500).send({ error: 'Failed to restore that server' });
    }
  });

  app.delete('/api/storage/orphans/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await deleteOrphan(id);
      return { ok: true };
    } catch (err) {
      return reply
        .code(400)
        .send({ error: err instanceof Error ? err.message : 'Failed to delete' });
    }
  });
}
