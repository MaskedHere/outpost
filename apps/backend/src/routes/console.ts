import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { prisma } from '../db/client.js';
import { requireAuth } from '../auth/plugin.js';
import { getContainer } from '../docker/containers.js';

export async function consoleRoutes(app: FastifyInstance) {
  app.get(
    '/ws/servers/:id/console',
    { websocket: true, preHandler: requireAuth },
    async (socket: WebSocket, request) => {
      const { id } = request.params as { id: string };
      const server = await prisma.gameServer.findUnique({ where: { id } });

      if (!server || !server.containerId) {
        socket.send('[outpost] server not found\n');
        socket.close();
        return;
      }

      const container = getContainer(server.containerId);

      try {
        const attachStream = await container.attach({
          stream: true,
          stdin: true,
          stdout: true,
          stderr: true,
        });

        attachStream.on('data', (chunk: Buffer) => {
          if (socket.readyState === socket.OPEN) socket.send(chunk.toString('utf8'));
        });
        attachStream.on('error', () => socket.close());
        attachStream.on('end', () => socket.close());

        socket.on('message', (raw: Buffer) => {
          const line = raw.toString('utf8');
          attachStream.write(line.endsWith('\n') ? line : `${line}\n`);
        });

        socket.on('close', () => {
          if (typeof (attachStream as NodeJS.ReadWriteStream & { destroy?: () => void }).destroy === 'function') {
            (attachStream as NodeJS.ReadWriteStream & { destroy: () => void }).destroy();
          }
        });
      } catch (err) {
        app.log.error(err);
        socket.send('[outpost] unable to attach to server console (is it running?)\n');
        socket.close();
      }
    },
  );
}
