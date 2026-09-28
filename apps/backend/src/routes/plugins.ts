import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { requireAuth } from '../auth/plugin.js';
import { searchPlugins, getProjectVersions, getVersion, getProject } from '../modrinth/client.js';

// Only Paper supports plugins.
const PLUGIN_LOADER = 'paper';

async function getProjectFromVersion(projectId: string, fallbackName: string) {
  try {
    return await getProject(projectId);
  } catch {
    return { id: projectId, slug: projectId, title: fallbackName, description: '', icon_url: null };
  }
}

const addPluginSchema = z.object({
  projectId: z.string(),
  versionId: z.string().optional(),
});

export async function pluginRoutes(app: FastifyInstance) {
  app.get('/api/modrinth/plugins', async (request, reply) => {
    const query = request.query as { q?: string; mcVersion?: string; offset?: string };
    if (!query.mcVersion) return reply.code(400).send({ error: 'mcVersion is required' });
    return searchPlugins({
      query: query.q ?? '',
      mcVersion: query.mcVersion,
      offset: query.offset ? Number(query.offset) : 0,
    });
  });

  app.get('/api/servers/:id/plugins', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await prisma.gameServer.findUnique({ where: { id } });
    if (!server) return reply.code(404).send({ error: 'Server not found' });
    if (server.game !== 'minecraft' || server.variant !== 'paper') {
      return reply.code(400).send({ error: 'Only Paper Minecraft servers support plugins' });
    }
    const plugins = await prisma.serverPlugin.findMany({
      where: { serverId: id },
      orderBy: { createdAt: 'asc' },
    });
    return { plugins, mcVersion: server.version };
  });

  app.post('/api/servers/:id/plugins', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await prisma.gameServer.findUnique({
      where: { id },
      include: { plugins: true },
    });
    if (!server) return reply.code(404).send({ error: 'Server not found' });
    if (server.game !== 'minecraft' || server.variant !== 'paper') {
      return reply.code(400).send({ error: 'Only Paper Minecraft servers support plugins' });
    }

    const parsed = addPluginSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });

    if (server.plugins.some((p) => p.projectId === parsed.data.projectId)) {
      return reply.code(409).send({ error: 'Already added' });
    }

    let version;
    if (parsed.data.versionId) {
      version = await getVersion(parsed.data.versionId);
    } else {
      const candidates = await getProjectVersions(parsed.data.projectId, {
        mcVersion: server.version,
        loader: PLUGIN_LOADER,
      });
      version = candidates[0];
      if (!version) {
        return reply.code(404).send({
          error: `No version of this plugin is available for Minecraft ${server.version} (Paper)`,
        });
      }
    }

    const primaryFile = version.files.find((f) => f.primary) ?? version.files[0];
    if (!primaryFile)
      return reply.code(400).send({ error: 'This plugin version has no downloadable file' });

    const project = await getProjectFromVersion(version.project_id, version.name);
    const created = await prisma.serverPlugin.create({
      data: {
        serverId: id,
        projectId: version.project_id,
        projectSlug: project.slug,
        projectName: project.title,
        versionId: version.id,
        versionNumber: version.version_number,
        filename: primaryFile.filename,
        downloadUrl: primaryFile.url,
        sha1: primaryFile.hashes.sha1,
        sha512: primaryFile.hashes.sha512,
        fileSizeBytes: primaryFile.size,
      },
    });

    return reply.code(201).send(created);
  });

  app.delete(
    '/api/servers/:id/plugins/:itemId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id, itemId } = request.params as { id: string; itemId: string };
      await prisma.serverPlugin.deleteMany({ where: { id: itemId, serverId: id } });
      return { ok: true };
    },
  );
}
