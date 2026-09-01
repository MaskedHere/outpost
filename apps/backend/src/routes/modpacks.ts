import path from 'node:path';
import fs from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { config } from '../config.js';
import { requireAuth } from '../auth/plugin.js';
import {
  searchMods,
  searchModpacks,
  getProjectVersions,
  getVersion,
  getProject,
  getGameVersions,
  type ModrinthSortIndex,
} from '../modrinth/client.js';
import { resolveDependencies } from '../modrinth/dependencies.js';
import { resolveLoaderVersion } from '../modrinth/loaderVersions.js';
import { buildMrpack } from '../modrinth/mrpack.js';
import { importPack, ImportError, type ImportedItem, type ImportResult } from '../modrinth/import.js';
import { createServer, ServerCreationError } from '../services/serverService.js';

const USER_AGENT = 'outpost-panel/0.1.0 (https://github.com/outpost-panel/outpost)';

// Modrinth's real category slugs (their /tag/category list), trimmed to the ones that are actually
// useful when building a server pack — the full list runs to dozens and is mostly client-side
// cosmetic tags that would never belong here.
const MOD_CATEGORIES: { value: string; label: string }[] = [
  { value: 'adventure', label: 'Adventure' },
  { value: 'technology', label: 'Technology' },
  { value: 'magic', label: 'Magic' },
  { value: 'utility', label: 'Utility' },
  { value: 'management', label: 'Server management' },
  { value: 'optimization', label: 'Performance' },
  { value: 'storage', label: 'Storage' },
  { value: 'food', label: 'Food & farming' },
  { value: 'mobs', label: 'Mobs' },
  { value: 'worldgen', label: 'World generation' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'library', label: 'Library / API' },
];

const SORT_LABELS: { value: ModrinthSortIndex; label: string }[] = [
  { value: 'relevance', label: 'Best match' },
  { value: 'downloads', label: 'Most downloaded' },
  { value: 'follows', label: 'Most followed' },
  { value: 'updated', label: 'Recently updated' },
  { value: 'newest', label: 'Newest' },
];

const SORT_OPTIONS = SORT_LABELS.map((s) => s.value);

export const MODDED_LOADERS = ['fabric', 'forge', 'neoforge', 'quilt'] as const;

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
  memoryMb: z.number().int().min(512).max(262144).default(4096),
  motd: z.string().max(200).optional(),
});

export async function modpackRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // Cached in memory — this list changes only when Mojang ships a new version, no need to hit
  // Modrinth on every page load of the server creation wizard.
  let gameVersionsCache: { at: number; versions: string[] } | null = null;
  app.get('/api/modrinth/game-versions', async () => {
    if (gameVersionsCache && Date.now() - gameVersionsCache.at < 60 * 60 * 1000) {
      return gameVersionsCache.versions;
    }
    const all = await getGameVersions();
    const versions = all.filter((v) => v.version_type === 'release').map((v) => v.version);
    gameVersionsCache = { at: Date.now(), versions };
    return versions;
  });

  app.get('/api/modrinth/search', async (request, reply) => {
    const query = request.query as {
      q?: string;
      mcVersion?: string;
      loader?: string;
      category?: string;
      sort?: string;
      serverOnly?: string;
      offset?: string;
    };
    if (!query.mcVersion || !query.loader) {
      return reply.code(400).send({ error: 'mcVersion and loader are required' });
    }
    const sort = SORT_OPTIONS.includes(query.sort as ModrinthSortIndex) ? (query.sort as ModrinthSortIndex) : 'relevance';
    return searchMods({
      query: query.q ?? '',
      mcVersion: query.mcVersion,
      loader: query.loader,
      category: query.category || undefined,
      sort,
      serverOnly: query.serverOnly === 'true',
      offset: query.offset ? Number(query.offset) : 0,
    });
  });

  /** The category slugs Outpost offers, and the labels the UI shows for them. Deliberately a
   *  curated subset of Modrinth's full tag list — the complete set is long and mostly noise for
   *  someone assembling a server pack. */
  app.get('/api/modrinth/filters', async () => ({ categories: MOD_CATEGORIES, sorts: SORT_LABELS }));

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
    const pack = await prisma.pack.create({ data: parsed.data, include: { items: true } });
    return reply.code(201).send(pack);
  });

  // Imports a modpack from an uploaded .mrpack, CurseForge zip, or a raw zip of .jar mods, creating
  // a new (fully editable) Pack. mcVersion/loader form fields are used only when the upload itself
  // doesn't carry that info (a bare jars zip has no manifest to read it from).
  app.post('/api/packs/import', async (request, reply) => {
    let fileBuffer: Buffer | null = null;
    let originalFilename = 'import';
    const fields: Record<string, string> = {};

    for await (const part of request.parts()) {
      if (part.type === 'file') {
        fileBuffer = await part.toBuffer();
        originalFilename = part.filename;
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }

    if (!fileBuffer) return reply.code(400).send({ error: 'No file uploaded' });

    let result: ImportResult;
    try {
      result = await importPack(fileBuffer);
    } catch (err) {
      if (err instanceof ImportError) return reply.code(400).send({ error: err.message });
      app.log.error(err);
      return reply.code(500).send({ error: 'Failed to read the uploaded pack' });
    }

    const fallbackName = fields.name || originalFilename.replace(/\.(mrpack|zip)$/i, '');
    const created = await createPackFromImportResult(result, fallbackName, {
      mcVersion: fields.mcVersion,
      loader: fields.loader,
    });
    if ('error' in created) return reply.code(400).send(created);

    return reply.code(201).send({ pack: created.pack, format: result.format, unresolved: result.unresolved, clientOnly: result.clientOnly });
  });

  // Imports an uploaded .mrpack/CurseForge zip/jars zip INTO an already-existing pack, instead of
  // creating a new one — e.g. "I already built this pack in Outpost, but here's an updated
  // modpack.zip I want to bring in." `replace: true` clears the pack first; otherwise the import
  // is merged in, skipping anything already in the pack (a mod present in both stays whatever
  // version it already was, not silently overwritten by the import's pin).
  app.post('/api/packs/:id/import', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await prisma.pack.findUnique({ where: { id }, include: { items: true } });
    if (!existing) return reply.code(404).send({ error: 'Pack not found' });

    let fileBuffer: Buffer | null = null;
    let replace = false;
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        fileBuffer = await part.toBuffer();
      } else if (part.fieldname === 'replace') {
        replace = String(part.value) === 'true';
      }
    }
    if (!fileBuffer) return reply.code(400).send({ error: 'No file uploaded' });

    let result: ImportResult;
    try {
      result = await importPack(fileBuffer);
    } catch (err) {
      if (err instanceof ImportError) return reply.code(400).send({ error: err.message });
      app.log.error(err);
      return reply.code(500).send({ error: 'Failed to read the uploaded pack' });
    }

    // Refuse rather than silently mixing in mods for a different Minecraft version/loader than
    // this pack already targets — a bare jars zip has neither, so only checks when the import
    // itself actually declares one.
    if (result.mcVersion && result.mcVersion !== existing.mcVersion) {
      return reply.code(400).send({ error: `This pack is for Minecraft ${existing.mcVersion}, but the import is for ${result.mcVersion}` });
    }
    if (result.loader && result.loader !== existing.loader) {
      return reply.code(400).send({ error: `This pack uses ${existing.loader}, but the import is for ${result.loader}` });
    }

    if (replace) {
      await prisma.packItem.deleteMany({ where: { packId: id } });
    }

    // Keyed on filename rather than projectId now — local items (no Modrinth project at all) need
    // a dedup key too, and it's the pack's actual unique constraint (@@unique([packId, filename])).
    const keepFilenames = replace ? new Set<string>() : new Set(existing.items.map((item) => item.filename));
    const toCreate = result.matched.filter((item) => !keepFilenames.has(item.filename));

    await persistPackItems(id, toCreate);

    const updated = await prisma.pack.findUnique({ where: { id }, include: { items: true } });
    return { pack: updated, format: result.format, unresolved: result.unresolved, clientOnly: result.clientOnly };
  });

  // Search Modrinth's own pre-made modpacks (a project_type distinct from individual mods) —
  // lets the server wizard offer "browse an existing pack" alongside import/build-from-scratch.
  // CurseForge doesn't have an equivalent here: their search API is gated behind a developer key
  // Outpost doesn't have, so CurseForge packs stay import-only (upload the zip you already have).
  // mcVersion/loader are optional filters, not requirements. Forcing them hid almost every real
  // modpack: the wizard defaults to the newest Minecraft version, while the big packs people
  // actually search for track an older one (All the Mods 10 is 1.21.1/NeoForge), so a default search
  // returned nothing but obscure packs that happened to match. A pack carries its own version and
  // loader, and importing one adopts them — so there's no reason to filter the catalogue by whatever
  // the wizard happened to be preset to.
  app.get('/api/modrinth/modpacks', async (request) => {
    const query = request.query as { q?: string; mcVersion?: string; loader?: string; offset?: string };
    return searchModpacks({
      query: query.q ?? '',
      mcVersion: query.mcVersion || undefined,
      loader: query.loader || undefined,
      offset: query.offset ? Number(query.offset) : 0,
    });
  });

  // Downloads a Modrinth modpack project's own .mrpack (its "primary file", same as what a user
  // would get clicking Download on the project page) and imports it through the same pipeline as
  // an uploaded file — reuses all the existing resolution logic, just skips the manual download step.
  app.post('/api/modrinth/modpacks/:projectId/import', async (request, reply) => {
    const { projectId } = request.params as { projectId: string };
    const body = (request.body ?? {}) as { mcVersion?: string; loader?: string };

    // Prefer a build matching what the wizard is currently set to, but fall back to the pack's own
    // latest release rather than refusing. Browsing is no longer version-filtered (see the search
    // route above), so most packs someone picks won't match the preset — and the pack dictates its
    // own Minecraft version and loader anyway, which createPackFromImportResult reads back out of
    // the downloaded file.
    const preferred = await getProjectVersions(projectId, { mcVersion: body.mcVersion, loader: body.loader });
    const version = preferred[0] ?? (await getProjectVersions(projectId))[0];
    if (!version) {
      return reply.code(404).send({ error: 'This modpack has no downloadable versions' });
    }
    const file = version.files.find((f) => f.primary) ?? version.files[0];
    if (!file) return reply.code(404).send({ error: 'This modpack version has no downloadable file' });

    const fileRes = await fetch(file.url, { headers: { 'User-Agent': USER_AGENT } });
    if (!fileRes.ok) return reply.code(502).send({ error: 'Failed to download modpack from Modrinth' });
    const buffer = Buffer.from(await fileRes.arrayBuffer());

    let result: ImportResult;
    try {
      result = await importPack(buffer);
    } catch (err) {
      if (err instanceof ImportError) return reply.code(400).send({ error: err.message });
      app.log.error(err);
      return reply.code(500).send({ error: 'Failed to read modpack from Modrinth' });
    }

    const project = await getProjectFromVersion(projectId, version.name);
    const created = await createPackFromImportResult(result, project.title, {
      mcVersion: body.mcVersion,
      loader: body.loader,
    });
    if ('error' in created) return reply.code(400).send(created);

    return reply.code(201).send({ pack: created.pack, format: result.format, unresolved: result.unresolved, clientOnly: result.clientOnly });
  });

  app.get('/api/packs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const pack = await prisma.pack.findUnique({
      where: { id },
      include: { items: true, servers: { select: { id: true, name: true } } },
    });
    if (!pack) return reply.code(404).send({ error: 'Pack not found' });
    return pack;
  });

  app.delete('/api/packs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.pack.delete({ where: { id } }).catch(() => null);
    // Prisma's cascade only covers the PackItem rows — the locally-stored jar files (if any) live
    // on disk under config.packsDir and need cleaning up separately.
    await fs.rm(path.join(config.packsDir, id), { recursive: true, force: true });
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

    // Modrinth curates a server_side flag per project, and "unsupported" means the mod genuinely
    // cannot run headless. Installing one anyway doesn't degrade gracefully — it hard-crashes the
    // server on boot before the world ever loads (Sodium, for instance, dies on
    // NoClassDefFoundError: org/lwjgl/Version, since LWJGL is client-only OpenGL glue). Every other
    // path into a pack already screens for this (see import.ts's classifyJarsByHash and the
    // CurseForge add route); this one didn't, which is how a client-only mod reached a live server.
    const project = await getProject(version.project_id).catch(() => null);
    if (project?.server_side === 'unsupported') {
      return reply.code(400).send({
        error: `${project.title} is a client-only mod — it doesn't run on a dedicated server, and adding it would stop this server from starting.`,
      });
    }

    const existingProjectIds = new Set(pack.items.map((item) => item.projectId).filter((id): id is string => id !== null));
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
      // A client-only *dependency* is skipped rather than rejected: the mod the user actually asked
      // for still installs and runs, it just doesn't drag in something that would crash the server.
      if (entry.isDependency && project.server_side === 'unsupported') continue;

      await prisma.packItem.upsert({
        where: { packId_filename: { packId: id, filename: primaryFile.filename } },
        create: {
          packId: id,
          source: 'modrinth',
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
    if (item.localFilePath) {
      await fs.rm(path.join(config.packsDir, item.localFilePath), { force: true });
    }
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
        variant: pack.loader,
        version: pack.mcVersion,
        memoryMb: parsed.data.memoryMb,
        packId: pack.id,
        motd: parsed.data.motd,
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
    // Unknown side support — assume it's installable rather than silently dropping a mod we simply
    // couldn't look up, matching projectMeta's behaviour in import.ts.
    return {
      id: projectId,
      slug: projectId,
      title: fallbackName,
      description: '',
      icon_url: null,
      server_side: 'required' as const,
    };
  }
}

/** Shared by the zip-upload import and the "browse existing Modrinth packs" import — both end up
 *  with the same ImportResult shape and need the same fallback-field/validation handling. */
export async function createPackFromImportResult(
  result: ImportResult,
  fallbackName: string,
  overrides: { mcVersion?: string; loader?: string },
) {
  const mcVersion = result.mcVersion ?? overrides.mcVersion;
  const loader = result.loader ?? overrides.loader;
  if (!mcVersion || !loader) {
    return {
      error: "Couldn't detect a Minecraft version/loader from this pack — specify them and try again.",
      format: result.format,
    };
  }
  if (!MODDED_LOADERS.includes(loader as (typeof MODDED_LOADERS)[number])) {
    return { error: `Unsupported loader: ${loader}` };
  }

  const name = (result.suggestedName || fallbackName || 'Imported pack').slice(0, 64);

  const pack = await prisma.pack.create({ data: { name, mcVersion, loader } });
  await persistPackItems(pack.id, result.matched);
  await persistOverrideFiles(pack.id, result.overrideFiles);

  const withItems = await prisma.pack.findUnique({ where: { id: pack.id }, include: { items: true } });
  return { pack: withItems! };
}

/** Writes a CurseForge pack's non-mod overrides/ files (configs, resourcepacks, scripts) to disk
 *  under config.packsDir/<packId>/overrides/ — mirrored as-is into the deployed server's dataPath
 *  at create time (see serverService.ts's copyPackOverrides). No DB row needed: deploy just checks
 *  whether this directory exists. */
async function persistOverrideFiles(packId: string, files: { path: string; buffer: Buffer }[] | undefined) {
  if (!files || files.length === 0) return;
  const overridesDir = path.join(config.packsDir, packId, 'overrides');
  for (const file of files) {
    const dest = path.join(overridesDir, file.path);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, file.buffer);
  }
}

/** Writes any items whose actual bytes we already have to disk under config.packsDir (only
 *  possible once the pack's id is known, hence this runs after pack creation rather than as a
 *  nested `create`), then inserts all of this batch's PackItem rows in one go. This includes
 *  source: 'modrinth' items too — a CurseForge-embedded jar that happened to hash-match a Modrinth
 *  project still deploys from the bytes already in hand rather than re-fetching that same file from
 *  Modrinth's CDN (see ImportedItem.fileBuffer and serverService.ts's copyLocalPackItems). */
export async function persistPackItems(packId: string, items: ImportedItem[]) {
  if (items.length === 0) return;
  const packDir = path.join(config.packsDir, packId);

  const data = await Promise.all(
    items.map(async (item) => {
      let localFilePath: string | null = null;
      if (item.fileBuffer) {
        await fs.mkdir(packDir, { recursive: true });
        await fs.writeFile(path.join(packDir, item.filename), item.fileBuffer);
        localFilePath = path.join(packId, item.filename);
      }
      return {
        packId,
        source: item.source,
        projectId: item.projectId,
        projectSlug: item.projectSlug,
        projectName: item.projectName,
        versionId: item.versionId,
        versionNumber: item.versionNumber,
        localFilePath,
        filename: item.filename,
        downloadUrl: item.downloadUrl,
        sha1: item.sha1,
        sha512: item.sha512,
        fileSizeBytes: item.fileSizeBytes,
        isDependency: item.isDependency ?? false,
      };
    }),
  );

  await prisma.packItem.createMany({ data });
}
