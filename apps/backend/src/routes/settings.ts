import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { requireAuth } from '../auth/plugin.js';
import { docker } from '../docker/client.js';

const SETTINGS_ID = 'default';

/** Total RAM of the Docker *host*, in MB. */
async function getHostMemoryMb(): Promise<number> {
  try {
    const info = (await docker.info()) as { MemTotal?: number };
    if (!info.MemTotal || info.MemTotal <= 0) return 16384;
    return Math.floor(info.MemTotal / 1024 / 1024);
  } catch {
    return 16384;
  }
}

async function getOrCreateSettings() {
  return prisma.settings.upsert({
    where: { id: SETTINGS_ID },
    update: {},
    create: { id: SETTINGS_ID },
  });
}

const updateSettingsSchema = z.object({
  // Empty string clears it.
  defaultPlayitKey: z.string().max(500).nullable().optional(),
  defaultMemoryMb: z.number().int().min(512).max(262144).optional(),
  useGameCache: z.boolean().optional(),
});

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/api/settings', { preHandler: requireAuth }, async () => {
    const settings = await getOrCreateSettings();
    // The memory sliders cap themselves at what this machine has rather than a guessed constant.
    const hostMemoryMb = await getHostMemoryMb();
    return { ...settings, hostMemoryMb };
  });

  app.patch('/api/settings', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = updateSettingsSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });

    await getOrCreateSettings();
    return prisma.settings.update({
      where: { id: SETTINGS_ID },
      data: {
        ...(parsed.data.defaultPlayitKey !== undefined && {
          defaultPlayitKey: parsed.data.defaultPlayitKey || null,
        }),
        ...(parsed.data.defaultMemoryMb !== undefined && {
          defaultMemoryMb: parsed.data.defaultMemoryMb,
        }),
        ...(parsed.data.useGameCache !== undefined && { useGameCache: parsed.data.useGameCache }),
      },
    });
  });
}
