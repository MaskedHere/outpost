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

/**
 * Picks `count` free host ports for a new server, none of them already used by another server and
 * none of them already bound on the host.
 */
export async function allocatePorts(count: number): Promise<number[]> {
  const used = new Set(
    (await prisma.gameServer.findMany({ select: { gamePort: true, rconPort: true } })).flatMap(
      (s) => (s.rconPort ? [s.gamePort, s.rconPort] : [s.gamePort]),
    ),
  );

  const allocated: number[] = [];
  for (
    let port = config.minecraftPortRangeStart;
    port < config.minecraftPortRangeStart + 5000 && allocated.length < count;
    port++
  ) {
    if (used.has(port) || allocated.includes(port)) continue;
    if (await isPortFree(port)) allocated.push(port);
  }

  if (allocated.length < count) throw new Error('No free port available in range');
  return allocated;
}
