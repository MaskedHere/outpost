import path from 'node:path';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import type { FastifyInstance, FastifyReply } from 'fastify';
import * as tar from 'tar';
import { prisma } from '../db/client.js';
import { config } from '../config.js';
import { requireAuth } from '../auth/plugin.js';
import { stopContainer, startContainer, getContainerStatus } from '../docker/containers.js';

async function getServer(id: string, reply: FastifyReply) {
  const server = await prisma.gameServer.findUnique({ where: { id } });
  if (!server) {
    reply.code(404).send({ error: 'Server not found' });
    return null;
  }
  return server;
}

export async function backupRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/api/servers/:id/backups', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await getServer(id, reply))) return;
    return prisma.backup.findMany({ where: { serverId: id }, orderBy: { createdAt: 'desc' } });
  });

  // Snapshots the server's data directory to a tar.gz.
  app.post('/api/servers/:id/backups', async (request, reply) => {
    const { id } = request.params as { id: string };
    const server = await getServer(id, reply);
    if (!server) return;

    const backupDir = path.join(config.backupsDir, id);
    await fs.mkdir(backupDir, { recursive: true });

    const filename = `${new Date().toISOString().replace(/[:.]/g, '-')}.tar.gz`;
    const destination = path.join(backupDir, filename);

    const wasRunning = server.containerId
      ? (await getContainerStatus(server.containerId).catch(() => null))?.state === 'running'
      : false;

    if (wasRunning && server.containerId) await stopContainer(server.containerId);
    try {
      await tar.create({ gzip: true, file: destination, cwd: server.dataPath }, ['.']);
    } finally {
      if (wasRunning && server.containerId) await startContainer(server.containerId);
    }

    const stat = await fs.stat(destination);
    const backup = await prisma.backup.create({
      data: { serverId: id, filename, sizeBytes: stat.size },
    });
    return reply.code(201).send(backup);
  });

  app.get('/api/servers/:id/backups/:backupId/download', async (request, reply) => {
    const { id, backupId } = request.params as { id: string; backupId: string };
    const backup = await prisma.backup.findUnique({ where: { id: backupId } });
    if (!backup || backup.serverId !== id)
      return reply.code(404).send({ error: 'Backup not found' });

    const filePath = path.join(config.backupsDir, id, backup.filename);
    reply.header('Content-Disposition', `attachment; filename="${backup.filename}"`);
    reply.header('Content-Type', 'application/gzip');
    return reply.send(createReadStream(filePath));
  });

  // Restores a backup on top of the current data directory.
  app.post('/api/servers/:id/backups/:backupId/restore', async (request, reply) => {
    const { id, backupId } = request.params as { id: string; backupId: string };
    const server = await getServer(id, reply);
    if (!server) return;
    const backup = await prisma.backup.findUnique({ where: { id: backupId } });
    if (!backup || backup.serverId !== id)
      return reply.code(404).send({ error: 'Backup not found' });

    const filePath = path.join(config.backupsDir, id, backup.filename);

    if (server.containerId) await stopContainer(server.containerId);
    await fs.rm(server.dataPath, { recursive: true, force: true });
    await fs.mkdir(server.dataPath, { recursive: true });
    await tar.extract({ file: filePath, cwd: server.dataPath });

    return { ok: true };
  });

  app.delete('/api/servers/:id/backups/:backupId', async (request, reply) => {
    const { id, backupId } = request.params as { id: string; backupId: string };
    const backup = await prisma.backup.findUnique({ where: { id: backupId } });
    if (!backup || backup.serverId !== id)
      return reply.code(404).send({ error: 'Backup not found' });

    await fs.rm(path.join(config.backupsDir, id, backup.filename), { force: true });
    await prisma.backup.delete({ where: { id: backupId } });
    return { ok: true };
  });
}
