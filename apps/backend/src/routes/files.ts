import path from 'node:path';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import { requireAuth } from '../auth/plugin.js';

/** Resolves a user-supplied relative path against a server's data dir, refusing traversal outside it. */
function resolveSafePath(dataPath: string, requestedPath: string | undefined): string {
  const relative = (requestedPath ?? '').replace(/^\/+/, '');
  const resolved = path.resolve(dataPath, relative);
  const root = path.resolve(dataPath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Path escapes server data directory');
  }
  return resolved;
}

async function getServerDataPath(id: string, reply: FastifyReply): Promise<string | null> {
  const server = await prisma.gameServer.findUnique({ where: { id } });
  if (!server) {
    reply.code(404).send({ error: 'Server not found' });
    return null;
  }
  return server.dataPath;
}

export async function fileRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/servers/:id/files', async (request, reply) => {
    const { id } = request.params as { id: string };
    const dataPath = await getServerDataPath(id, reply);
    if (!dataPath) return;

    const query = request.query as { path?: string };
    let target: string;
    try {
      target = resolveSafePath(dataPath, query.path);
    } catch {
      return reply.code(400).send({ error: 'Invalid path' });
    }

    const entries = await fs.readdir(target, { withFileTypes: true }).catch(() => null);
    if (!entries) return reply.code(404).send({ error: 'Directory not found' });

    const items = await Promise.all(
      entries.map(async (entry) => {
        const stat = await fs.stat(path.join(target, entry.name)).catch(() => null);
        return {
          name: entry.name,
          isDir: entry.isDirectory(),
          size: stat?.size ?? 0,
          mtime: stat?.mtime ?? null,
        };
      }),
    );

    return { path: query.path ?? '', items };
  });

  app.get('/api/servers/:id/files/content', async (request, reply) => {
    const { id } = request.params as { id: string };
    const dataPath = await getServerDataPath(id, reply);
    if (!dataPath) return;

    const query = request.query as { path?: string };
    let target: string;
    try {
      target = resolveSafePath(dataPath, query.path);
    } catch {
      return reply.code(400).send({ error: 'Invalid path' });
    }

    const stat = await fs.stat(target).catch(() => null);
    if (!stat || !stat.isFile()) return reply.code(404).send({ error: 'File not found' });
    if (stat.size > 5 * 1024 * 1024) {
      return reply.code(413).send({ error: 'File too large to edit in-browser (5MB limit)' });
    }

    const content = await fs.readFile(target, 'utf8');
    return { path: query.path, content };
  });

  app.put('/api/servers/:id/files/content', async (request, reply) => {
    const { id } = request.params as { id: string };
    const dataPath = await getServerDataPath(id, reply);
    if (!dataPath) return;

    const query = request.query as { path?: string };
    const body = request.body as { content?: string };
    let target: string;
    try {
      target = resolveSafePath(dataPath, query.path);
    } catch {
      return reply.code(400).send({ error: 'Invalid path' });
    }

    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, body.content ?? '', 'utf8');
    return { ok: true };
  });

  app.get('/api/servers/:id/files/download', async (request, reply) => {
    const { id } = request.params as { id: string };
    const dataPath = await getServerDataPath(id, reply);
    if (!dataPath) return;

    const query = request.query as { path?: string };
    let target: string;
    try {
      target = resolveSafePath(dataPath, query.path);
    } catch {
      return reply.code(400).send({ error: 'Invalid path' });
    }

    const stat = await fs.stat(target).catch(() => null);
    if (!stat || !stat.isFile()) return reply.code(404).send({ error: 'File not found' });

    reply.header('Content-Disposition', `attachment; filename="${path.basename(target)}"`);
    return reply.send(await fs.readFile(target));
  });

  app.post('/api/servers/:id/files/upload', async (request, reply) => {
    const { id } = request.params as { id: string };
    const dataPath = await getServerDataPath(id, reply);
    if (!dataPath) return;

    const query = request.query as { path?: string };
    let targetDir: string;
    try {
      targetDir = resolveSafePath(dataPath, query.path);
    } catch {
      return reply.code(400).send({ error: 'Invalid path' });
    }

    const file = await request.file();
    if (!file) return reply.code(400).send({ error: 'No file uploaded' });

    await fs.mkdir(targetDir, { recursive: true });
    const destination = path.join(targetDir, path.basename(file.filename));
    await pipeline(file.file, createWriteStream(destination));
    return { ok: true, name: path.basename(file.filename) };
  });

  app.post('/api/servers/:id/files/mkdir', async (request, reply) => {
    const { id } = request.params as { id: string };
    const dataPath = await getServerDataPath(id, reply);
    if (!dataPath) return;

    const body = request.body as { path?: string };
    let target: string;
    try {
      target = resolveSafePath(dataPath, body.path);
    } catch {
      return reply.code(400).send({ error: 'Invalid path' });
    }

    await fs.mkdir(target, { recursive: true });
    return { ok: true };
  });

  app.delete('/api/servers/:id/files', async (request, reply) => {
    const { id } = request.params as { id: string };
    const dataPath = await getServerDataPath(id, reply);
    if (!dataPath) return;

    const query = request.query as { path?: string };
    if (!query.path) return reply.code(400).send({ error: 'path is required' });

    let target: string;
    try {
      target = resolveSafePath(dataPath, query.path);
    } catch {
      return reply.code(400).send({ error: 'Invalid path' });
    }
    if (target === path.resolve(dataPath)) {
      return reply.code(400).send({ error: 'Refusing to delete server root' });
    }

    await fs.rm(target, { recursive: true, force: true });
    return { ok: true };
  });
}
