import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../db/client.js';
import { readContainerLogs } from '../docker/cli.js';
import { restartContainer } from '../docker/containers.js';

// Forge's crash report emits a "-- MOD <modid> --" block per failed mod, whose first detail line is
// "Mod File: <absolute path>". That's more reliable than any import-time heuristic.
const CRASHED_MOD_RE = /^-- MOD ([a-zA-Z0-9_-]+) --\r?\nDetails:\r?\n\s*Mod File:\s*(.+)$/gm;

export function detectCrashedModFiles(logs: string): { modId: string; filename: string }[] {
  const seen = new Set<string>();
  const results: { modId: string; filename: string }[] = [];
  for (const m of logs.matchAll(CRASHED_MOD_RE)) {
    const filePath = m[2]!.trim();
    const filename = filePath.split(/[\\/]/).pop() ?? filePath;
    if (!seen.has(filename)) {
      seen.add(filename);
      results.push({ modId: m[1]!, filename });
    }
  }
  return results;
}

// Filenames already auto-removed per server, so an unrelated crash can't trigger an endless restart
// loop. In-memory only: each file gets one attempt per backend run.
const attempted = new Map<string, Set<string>>();

/**
 * Checks a crashed container's logs for Forge's mod-loading crash report. Newly implicated mod
 * files are moved aside (not deleted), removed from the pack, and the container is restarted.
 * Returns the removed filenames, or null.
 */
export async function attemptModCrashRecovery(
  serverId: string,
  containerId: string,
  dataPath: string,
): Promise<{ removedMods: string[] } | null> {
  // Read a large tail: a crash-looping container produces thousands of log lines quickly, and a
  // small tail can miss every complete crash report.
  const logs = await readContainerLogs(containerId, 4000);
  const crashed = detectCrashedModFiles(logs);
  if (crashed.length === 0) return null;

  const alreadyTried = attempted.get(serverId) ?? new Set<string>();
  const toRemove = crashed.filter((c) => !alreadyTried.has(c.filename));
  if (toRemove.length === 0) return null;

  // Recorded synchronously, before any await, so two near-simultaneous status polls both seeing
  // 'crashed' can't both act on the same files.
  for (const c of toRemove) alreadyTried.add(c.filename);
  attempted.set(serverId, alreadyTried);

  const modsDir = path.join(dataPath, 'mods');
  const quarantineDir = path.join(dataPath, 'mods_disabled_crashed');
  await fs.mkdir(quarantineDir, { recursive: true });

  const removed: string[] = [];
  for (const c of toRemove) {
    try {
      await fs.rename(path.join(modsDir, c.filename), path.join(quarantineDir, c.filename));
      removed.push(c.filename);
    } catch {
      // Already gone, or never landed there.
      removed.push(c.filename);
    }
  }

  const server = await prisma.gameServer.findUnique({
    where: { id: serverId },
    select: { packId: true },
  });
  if (server?.packId) {
    await prisma.packItem.deleteMany({
      where: { packId: server.packId, filename: { in: removed } },
    });
  }

  await restartContainer(containerId);
  return { removedMods: removed };
}
