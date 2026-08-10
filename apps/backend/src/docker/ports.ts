import net from 'node:net';
import { prisma } from '../db/client.js';
import { config } from '../config.js';

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once('error', () => resolve(false))
      .once('listening', () => tester.close(() => resolve(true)))
      .listen(port, '0.0.0.0');
  });
}

/** Picks the next free host port for a new server, starting at MC_PORT_RANGE_START. */
export async function allocateGamePort(): Promise<number> {
  const used = new Set((await prisma.gameServer.findMany({ select: { gamePort: true } })).map((s) => s.gamePort));

  for (let port = config.minecraftPortRangeStart; port < config.minecraftPortRangeStart + 1000; port++) {
    if (used.has(port)) continue;
    if (await isPortFree(port)) return port;
  }

  throw new Error('No free port available in range');
}
