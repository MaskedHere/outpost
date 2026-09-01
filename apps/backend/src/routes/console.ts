import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { prisma } from '../db/client.js';
import { requireAuth } from '../auth/plugin.js';
import { followContainerLogs } from '../docker/cli.js';
import { rconExec, RconAuthError } from '../rcon/client.js';
import { config } from '../config.js';

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

      const tail = followContainerLogs(server.containerId, (text) => {
        if (socket.readyState === socket.OPEN) socket.send(text);
      });

      if (!server.rconPort || !server.rconPassword) {
        socket.send('[outpost] this game has no console commands — showing live logs only\n');
      }

      socket.on('message', (raw: Buffer) => {
        const line = raw.toString('utf8').trim();
        if (!line) return;

        if (!server.rconPort || !server.rconPassword) {
          if (socket.readyState === socket.OPEN) {
            socket.send('[outpost] this game has no console command support\n');
          }
          return;
        }

        rconExec(config.rconHost, server.rconPort, server.rconPassword, line)
          .then((out) => {
            if (out.trim() && socket.readyState === socket.OPEN) socket.send(`${out.trim()}\n`);
          })
          .catch((err) => {
            if (socket.readyState !== socket.OPEN) return;
            const message =
              err instanceof RconAuthError
                ? '[outpost] RCON authentication failed\n'
                : `[outpost] command failed: ${err instanceof Error ? err.message : String(err)}\n`;
            socket.send(message);
          });
      });

      socket.on('close', () => tail.stop());
    },
  );
}
