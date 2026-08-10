import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { requireAuth } from '../auth/plugin.js';
import { searchMods, getProjectVersions, getVersion, getProject } from '../modrinth/client.js';
import { resolveDependencies } from '../modrinth/dependencies.js';
import { resolveLoaderVersion } from '../modrinth/loaderVersions.js';
import { buildMrpack } from '../modrinth/mrpack.js';
import { createServer, ServerCreationError } from '../services/serverService.js';

const MODDED_LOADERS = ['fabric', 'forge', 'neoforge', 'quilt'] as const;

const createPackSchema = z.object({
  name: z.string().min(1).max(64),
  mcVersion: z.string(),
  loader: z.enum(MODDED_LOADERS),
});

const addItemSchema = z.object({
  projectId: z.string(),
  versionId: z.string().optional(),
});

const deploySchema = z.object({
  name: z.string().min(1).max(64),
  memoryMb: z.number().int().min(512).max(32768).default(4096),
});

export async function modpackRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/modrinth/search', async (request, reply) => {
    const query = request.query as { q?: string; mcVersion?: string; loader?: string; offset?: string };
    if (!query.mcVersion || !query.loader) {
      return reply.code(400).send({ error: 'mcVersion and loader are required' });
    }
    return searchMods({
      query: query.q ?? '',
      mcVersion: query.mcVersion,
      loader: query.loader,
      offset: query.offset ? Number(query.offset) : 0,
    });
  });

  app.get('/api/modrinth/projects/:projectId/versions', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const query = request.query as { mcVersion?: string; loader?: string };
    if (!query.mcVersion || !query.loader) {
      return reply.code(400).send({ error: 'mcVersion and loader are required' });
    }
    return getProjectVersions(projectId, { mcVersion: query.mcVersion, loader: query.loader });
  });

  app.get('/api/packs', async () => {
    return prisma.pack.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { items: true } } },
    });
  });

  app.post('/api/packs', async (request, reply) => {
    const parsed = createPackSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
    }
    const pack = await prisma.pack.create({ data: parsed.data });
    return reply.code(201).send(pack);
  });

  app.get('/api/packs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const pack = await prisma.pack.findUnique({ where: { id }, include: { items: true } });
    if (!pack) return reply.code(404).send({ error: 'Pack not found' });
    return pack;
  });

  app.delete('/api/packs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.pack.delete({ where: { id } }).catch(() => null);
    return reply.send({ ok: true });
  });

  // Adds a mod to the pack, resolving and pinning its required-dependency tree at the same time
  // so the exported .mrpack and the "deploy to server" env vars stay self-contained.
  app.post('/api/packs/:id/items', async (request, reply) => {
    const { id } = request.params as { id: string };
    const pack = await prisma.pack.findUnique({ where: { id }, include: { items: true } });
    if (!pack) return reply.code(404).send({ error: 'Pack not found' });

    const parsed = addItemSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
    }

    let version;
    if (parsed.data.versionId) {
      version = await getVersion(parsed.data.versionId);
    } else {
      const candidates = await getProjectVersions(parsed.data.projectId, {
        mcVersion: pack.mcVersion,
        loader: pack.loader,
      });
      version = candidates[0];
      if (!version) {
        return reply.code(404).send({
          error: `No version of this mod is available for Minecraft ${pack.mcVersion} (${pack.loader})`,
        });
      }
    }

    const existingProjectIds = new Set(pack.items.map((item) => item.projectId));
    const dependencyVersions = existingProjectIds.has(version.project_id)
      ? []
      : await resolveDependencies(version, pack.mcVersion, pack.loader, new Set(existingProjectIds));

    const toInsert = [
      { version, isDependency: false },
      ...dependencyVersions
        .filter((v) => !existingProjectIds.has(v.project_id))
        .map((v) => ({ version: v, isDependency: true })),
    ].filter((entry, index, arr) => arr.findIndex((e) => e.version.project_id === entry.version.project_id) === index);

    for (const entry of toInsert) {
      const primaryFile = entry.version.files.find((f) => f.primary) ?? entry.version.files[0];
      if (!primaryFile) continue;
      const project = await getProjectFromVersion(entry.version.project_id, entry.version.name);

      await prisma.packItem.upsert({
        where: { packId_projectId: { packId: id, projectId: entry.version.project_id } },
        create: {
          packId: id,
          projectId: entry.version.project_id,
          projectSlug: project.slug,
          projectName: project.title,
          versionId: entry.version.id,
          versionNumber: entry.version.version_number,
          filename: primaryFile.filename,
          downloadUrl: primaryFile.url,
          sha1: primaryFile.hashes.sha1,
          sha512: primaryFile.hashes.sha512,
          fileSizeBytes: primaryFile.size,
          isDependency: entry.isDependency,
        },
        update: {},
      });
    }

    const updated = await prisma.pack.findUnique({ where: { id }, include: { items: true } });
    return updated;
  });

  app.delete('/api/packs/:id/items/:itemId', async (request, reply) => {
    const { id, itemId } = request.params as { id: string; itemId: string };
    const item = await prisma.packItem.findUnique({ where: { id: itemId } });
    if (!item || item.packId !== id) return reply.code(404).send({ error: 'Item not found' });
    await prisma.packItem.delete({ where: { id: itemId } });
    return { ok: true };
  });

  // Spins up a real game server pre-loaded with this pack's mods (via itzg's MODRINTH_PROJECTS).
  app.post('/api/packs/:id/deploy', async (request, reply) => {
    const { id } = request.params as { id: string };
    const pack = await prisma.pack.findUnique({ where: { id } });
    if (!pack) return reply.code(404).send({ error: 'Pack not found' });

    const parsed = deploySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
    }

    try {
      const server = await createServer({
        name: parsed.data.name,
        loader: pack.loader,
        mcVersion: pack.mcVersion,
        memoryMb: parsed.data.memoryMb,
        packId: pack.id,
      });
      return reply.code(201).send(server);
    } catch (err) {
      if (err instanceof ServerCreationError) {
        return reply.code(err.statusCode).send({ error: err.message });
      }
      app.log.error(err);
      return reply.code(500).send({ error: 'Failed to deploy pack' });
    }
  });

  // Exports a standard .mrpack that friends install client-side with one click.
  app.get('/api/packs/:id/export', async (request, reply) => {
    const { id } = request.params as { id: string };
    const pack = await prisma.pack.findUnique({ where: { id }, include: { items: true } });
    if (!pack) return reply.code(404).send({ error: 'Pack not found' });
    if (pack.items.length === 0) return reply.code(400).send({ error: 'Pack has no mods yet' });

    const loaderVersion = await resolveLoaderVersion(pack.loader, pack.mcVersion);
    const safeName = pack.name.replace(/[^a-z0-9-_]+/gi, '_');

    reply.header('Content-Disposition', `attachment; filename="${safeName}.mrpack"`);
    reply.header('Content-Type', 'application/x-modrinth-modpack+zip');
    return reply.send(buildMrpack(pack, loaderVersion));
  });
}

async function getProjectFromVersion(projectId: string, fallbackName: string) {
  try {
    return await getProject(projectId);
  } catch {
    return { id: projectId, slug: projectId, title: fallbackName, description: '', icon_url: null };
  }
}
