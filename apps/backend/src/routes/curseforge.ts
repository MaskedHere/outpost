import type { FastifyInstance } from 'fastify';
import { prisma } from '../db/client.js';
import { requireAuth } from '../auth/plugin.js';
import {
  searchModpacks,
  searchMods,
  resolveDownloadUrl,
  findServerPackFileId,
  resolveRequiredDependencyChain,
  searchPalworldMods,
  PALWORLD_CATEGORIES,
  PALWORLD_FILTER_TAGS,
  CURSEFORGE_MC_CATEGORIES,
} from '../curseforge/scraper.js';
import { getProject as getModrinthProject } from '../modrinth/client.js';
import {
  importPack,
  ImportError,
  classifyJarsByHash,
  type ImportedItem,
  type UnresolvedEntry,
} from '../modrinth/import.js';
import { createPackFromImportResult, persistPackItems } from './modpacks.js';
import { createImportJob, updateImportJob, getImportJob } from '../jobs/importJobs.js';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Best-effort client/server side tags for CurseForge results. */
const sideTagCache = new Map<string, { clientSide: string; serverSide: string } | null>();

async function withSideTags<T extends { slug: string }>(hits: T[]) {
  const LOOKUP_TIMEOUT_MS = 2500;

  const results = await Promise.all(
    hits.map(async (hit) => {
      if (sideTagCache.has(hit.slug)) return { ...hit, ...(sideTagCache.get(hit.slug) ?? {}) };
      try {
        const project = await Promise.race([
          getModrinthProject(hit.slug),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), LOOKUP_TIMEOUT_MS),
          ),
        ]);
        const tags = { clientSide: project.client_side, serverSide: project.server_side };
        sideTagCache.set(hit.slug, tags);
        return { ...hit, ...tags };
      } catch {
        // Not on Modrinth, or Modrinth is unhappy.
        sideTagCache.set(hit.slug, null);
        return hit;
      }
    }),
  );
  return results;
}

export async function curseforgeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/curseforge/modpacks', async (request, reply) => {
    const query = request.query as { q?: string; mcVersion?: string; offset?: string };
    try {
      const hits = await searchModpacks({
        query: query.q ?? '',
        mcVersion: query.mcVersion,
        offset: query.offset ? Number(query.offset) : 0,
      });
      return { hits };
    } catch (err) {
      app.log.error(err);
      return reply.code(502).send({
        error:
          'Failed to search CurseForge — their site may have changed, or is temporarily blocking automated access.',
      });
    }
  });

  // Individual-mod search for the "Build modpack" flow (add mods to a pack one at a time)
  app.get('/api/curseforge/mods', async (request, reply) => {
    const query = request.query as {
      q?: string;
      mcVersion?: string;
      loader?: string;
      category?: string;
      offset?: string;
    };
    try {
      const hits = await searchMods({
        query: query.q ?? '',
        mcVersion: query.mcVersion,
        loader: query.loader,
        category: query.category || undefined,
        offset: query.offset ? Number(query.offset) : 0,
      });
      return { hits: await withSideTags(hits) };
    } catch (err) {
      app.log.error(err);
      return reply.code(502).send({
        error:
          'Failed to search CurseForge — their site may have changed, or is temporarily blocking automated access.',
      });
    }
  });

  /** The category filters offered alongside a CurseForge mod search. */
  app.get('/api/curseforge/categories', async () => ({ categories: CURSEFORGE_MC_CATEGORIES }));

  // Downloads one CurseForge file and classifies it like the full-pack import does. Returns null
  // for a client-only mod; the caller decides whether that's fatal.
  async function downloadAndClassify(
    slug: string,
    fileId: number,
  ): Promise<{ item: ImportedItem; clientOnlyLabel?: string } | null> {
    const downloadUrl = await resolveDownloadUrl(slug, fileId, 'mc-mods');
    const fileRes = await fetch(downloadUrl, { headers: { 'User-Agent': USER_AGENT } });
    if (!fileRes.ok) return null;
    const buffer = Buffer.from(await fileRes.arrayBuffer());
    const filename = new URL(downloadUrl).pathname.split('/').pop() || `${slug}.jar`;

    const matched: ImportedItem[] = [];
    const clientOnly: UnresolvedEntry[] = [];
    await classifyJarsByHash([{ filename, buffer }], matched, clientOnly);
    if (clientOnly.length > 0) return { item: matched[0]!, clientOnlyLabel: clientOnly[0]!.label };
    if (matched.length === 0) return null;
    return { item: matched[0]! };
  }

  // Adds one mod (picked from the search above) straight into an existing pack.
  app.post('/api/curseforge/mods/add', async (request, reply) => {
    const body = (request.body ?? {}) as {
      packId?: string;
      slug?: string;
      fileId?: number;
      logoUrl?: string | null;
    };
    if (!body.packId || !body.slug || !body.fileId) {
      return reply.code(400).send({ error: 'packId, slug, and fileId are required' });
    }

    try {
      const pack = await prisma.pack.findUnique({
        where: { id: body.packId },
        include: { items: true },
      });
      if (!pack) return reply.code(404).send({ error: 'Pack not found' });

      const primary = await downloadAndClassify(body.slug, body.fileId);
      if (!primary)
        return reply.code(502).send({ error: 'Failed to download this mod from CurseForge' });
      if (primary.clientOnlyLabel) {
        return reply.code(400).send({
          error: `${primary.clientOnlyLabel} is a client-only mod — it doesn't run on a dedicated server.`,
        });
      }

      // Only when the item didn't already resolve to a Modrinth project.
      const toAdd: ImportedItem[] = [
        { ...primary.item, iconUrl: primary.item.iconUrl ?? body.logoUrl ?? null },
      ];
      const existingFilenames = new Set(pack.items.map((i) => i.filename));

      const depChain = await resolveRequiredDependencyChain(
        body.slug,
        pack.mcVersion,
        pack.loader,
      ).catch(() => []);
      for (const dep of depChain) {
        const resolved = await downloadAndClassify(dep.slug, dep.fileId).catch(() => null);
        if (!resolved || resolved.clientOnlyLabel) continue;
        if (existingFilenames.has(resolved.item.filename)) continue;
        existingFilenames.add(resolved.item.filename);
        toAdd.push({ ...resolved.item, isDependency: true });
      }

      await persistPackItems(body.packId, toAdd);
      const updated = await prisma.pack.findUnique({
        where: { id: body.packId },
        include: { items: true },
      });
      if (!updated) return reply.code(404).send({ error: 'Pack not found' });
      return { pack: updated };
    } catch (err) {
      app.log.error(err);
      return reply
        .code(502)
        .send({ error: err instanceof Error ? err.message : 'Failed to add this mod' });
    }
  });

  // CurseForge hosts Palworld mods under the same page structure as Minecraft's, so the same
  // scraper covers them.
  app.get('/api/curseforge/palworld/categories', async () => ({
    types: PALWORLD_CATEGORIES,
    tags: PALWORLD_FILTER_TAGS,
  }));

  app.get('/api/curseforge/palworld/mods', async (request, reply) => {
    const query = request.query as {
      q?: string;
      type?: string;
      category?: string;
      offset?: string;
    };
    try {
      const hits = await searchPalworldMods({
        query: query.q ?? '',
        type: query.type,
        category: query.category || undefined,
        offset: query.offset ? Number(query.offset) : 0,
      });
      return { hits };
    } catch (err) {
      app.log.error(err);
      return reply.code(502).send({
        error:
          'Failed to search CurseForge — their site may be temporarily blocking automated access.',
      });
    }
  });

  // Imports can take minutes, so this starts a background job and returns its id; the frontend
  // polls GET .../import-jobs/:jobId for progress.
  app.post('/api/curseforge/modpacks/import', async (request, reply) => {
    const body = (request.body ?? {}) as {
      slug?: string;
      fileId?: number;
      mcVersion?: string;
      loader?: string;
      name?: string;
    };
    if (!body.slug || !body.fileId)
      return reply.code(400).send({ error: 'slug and fileId are required' });
    if (!body.mcVersion || !body.loader)
      return reply.code(400).send({ error: 'mcVersion and loader are required' });

    const jobId = createImportJob();
    reply.code(202).send({ jobId });

    // Not awaited - the response above already went out.
    void runImport(app, jobId, body as Required<typeof body>);
  });

  app.get('/api/curseforge/import-jobs/:jobId', async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = getImportJob(jobId);
    if (!job) return reply.code(404).send({ error: 'Job not found (it may have expired)' });
    return job;
  });
}

async function runImport(
  app: FastifyInstance,
  jobId: string,
  body: { slug: string; fileId: number; mcVersion: string; loader: string; name?: string },
) {
  try {
    updateImportJob(jobId, { phase: 'resolving' });
    // Prefer the pack's dedicated "Server Pack" file when it publishes one.
    const serverPackFileId = await findServerPackFileId(body.slug).catch(() => null);
    const downloadUrl = await resolveDownloadUrl(body.slug, serverPackFileId ?? body.fileId);

    const fileRes = await fetch(downloadUrl, { headers: { 'User-Agent': USER_AGENT } });
    if (!fileRes.ok || !fileRes.body) throw new Error('Failed to download modpack from CurseForge');

    const total = Number(fileRes.headers.get('content-length') ?? 0);
    const chunks: Uint8Array[] = [];
    let downloaded = 0;
    updateImportJob(jobId, { phase: 'downloading', current: 0, total });
    for await (const chunk of fileRes.body as unknown as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
      downloaded += chunk.length;
      updateImportJob(jobId, { phase: 'downloading', current: downloaded, total });
    }
    const buffer = Buffer.concat(chunks);

    const result = await importPack(buffer, (current, matchTotal) => {
      updateImportJob(jobId, { phase: 'matching', current, total: matchTotal });
    });

    const created = await createPackFromImportResult(result, body.name || body.slug, {
      mcVersion: body.mcVersion,
      loader: body.loader,
    });
    if ('error' in created) {
      updateImportJob(jobId, { phase: 'error', error: created.error ?? 'Import failed' });
      return;
    }

    updateImportJob(jobId, {
      phase: 'done',
      pack: created.pack,
      format: result.format,
      unresolved: result.unresolved,
      clientOnly: result.clientOnly,
    });
  } catch (err) {
    app.log.error(err);
    const message =
      err instanceof ImportError || err instanceof Error ? err.message : 'Import failed';
    updateImportJob(jobId, { phase: 'error', error: message });
  }
}
