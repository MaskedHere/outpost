import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../db/client.js';
import { readContainerLogs } from '../docker/cli.js';
import { restartContainer } from '../docker/containers.js';

// Forge's ServerModLoader crash report emits one "-- MOD <modid> --" block per mod that failed to
// construct/load, and that block's very first detail line is always "Mod File: <absolute path>" —
// Forge itself telling us exactly which file is at fault, no guessing needed. This is more
// reliable than any pre-import heuristic (hash match, name search, jar metadata): a mod Outpost's
// own client-only detection missed at import time (a build never uploaded to Modrinth under any
// name, a mismatched dependency, anything) still gets caught here, because this reads the actual
// runtime failure directly from the one source of truth that can't be wrong about it.
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

// Which filenames Outpost has already tried auto-removing per server, so a crash that isn't
// actually explained by those specific mods (some other, unrelated problem) doesn't restart
// forever — recovery is attempted at most once per newly-implicated file. Deliberately in-memory
// only: this is a live-crash-loop mitigation, not something that needs to survive a backend
// restart (a fresh restart gets one fresh attempt per file, which is fine).
const attempted = new Map<string, Set<string>>();

/** Checks a crashed container's own logs for Forge's mod-loading crash report; if it implicates
 *  any mod file Outpost hasn't already tried removing for this server, quarantines those files
 *  (moved aside, not deleted — same non-destructive pattern as a manual fix), drops them from the
 *  pack so a future redeploy doesn't reintroduce them, and restarts the container. Returns the
 *  list of removed filenames, or null if there was nothing new to try. */
export async function attemptModCrashRecovery(
  serverId: string,
  containerId: string,
  dataPath: string,
): Promise<{ removedMods: string[] } | null> {
  // A container stuck in Docker's `unless-stopped` restart loop can accumulate tens of thousands
  // of log lines fast (a single Forge mod-loading crash report alone runs a few hundred lines) —
  // a small tail can land entirely within one still-booting cycle that hasn't crashed yet and miss
  // every complete report from the many cycles before it. 4000 lines comfortably covers several
  // full cycles regardless of exactly when between crashes this happens to run.
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
      // Already gone, or never landed there — nothing to move, but still worth restarting without it.
      removed.push(c.filename);
    }
  }

  const server = await prisma.gameServer.findUnique({ where: { id: serverId }, select: { packId: true } });
  if (server?.packId) {
    await prisma.packItem.deleteMany({ where: { packId: server.packId, filename: { in: removed } } });
  }

  await restartContainer(containerId);
  return { removedMods: removed };
}
