import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { getGameDefinition, listGameDefinitions } from '../games/registry.js';
import { createServerContainer, removeContainer, getContainerStatus } from '../docker/containers.js';
import { allocatePorts } from '../docker/ports.js';
import { getServerReadiness } from './readinessService.js';

/**
 * A shared, per-game copy of the large game/engine files that SteamCMD-backed images would
 * otherwise download from Steam in full for every single new server — 6.87GB for Garry's Mod alone,
 * measured live on a fresh create. The bytes are identical for everyone, so they're kept once here
 * and copied into each new server's own data directory at create time.
 *
 * Only volumes a GameDefinition explicitly names via `contentCache` are ever cached, so per-server
 * state (world saves, configs, RCON secrets) can't leak between servers — see the doc comment on
 * GameDefinition.contentCache.
 */

function cacheDirFor(gameId: string): string {
  return path.join(config.gameCacheDir, gameId);
}

/** A cache is only usable once it's been fully written — an interrupted copy (crash, restart,
 *  killed prewarm) would otherwise leave a half-populated directory that looks cached but would
 *  seed every future server with a broken install. The marker file is written last, so its
 *  presence is the only thing that counts as "cached". */
function markerPathFor(gameId: string): string {
  return path.join(cacheDirFor(gameId), '.outpost-cache-complete');
}

export interface CachedGameInfo {
  gameId: string;
  displayName: string;
  approxSizeLabel: string;
  cached: boolean;
  sizeBytes: number | null;
  cachedAt: string | null;
  busy: boolean;
}

// Populating a cache means copying several GB, so it runs detached — this tracks which games are
// mid-copy (or mid-prewarm) so the UI can show progress and duplicate requests get rejected.
const busyGames = new Set<string>();

export function isCacheBusy(gameId: string): boolean {
  return busyGames.has(gameId);
}

export function markCacheBusy(gameId: string): void {
  busyGames.add(gameId);
}

export function clearCacheBusy(gameId: string): void {
  busyGames.delete(gameId);
}

export async function hasCache(gameId: string): Promise<boolean> {
  return fs
    .access(markerPathFor(gameId))
    .then(() => true)
    .catch(() => false);
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const stat = await fs.stat(path.join(entry.parentPath, entry.name)).catch(() => null);
    if (stat) total += stat.size;
  }
  return total;
}

export async function listCaches(): Promise<CachedGameInfo[]> {
  const defs = listGameDefinitions().filter((d) => d.contentCache);
  return Promise.all(
    defs.map(async (def) => {
      const cached = await hasCache(def.id);
      const marker = cached ? await fs.stat(markerPathFor(def.id)).catch(() => null) : null;
      return {
        gameId: def.id,
        displayName: def.displayName,
        approxSizeLabel: def.contentCache!.approxSizeLabel,
        cached,
        sizeBytes: cached ? await dirSize(cacheDirFor(def.id)) : null,
        cachedAt: marker ? marker.mtime.toISOString() : null,
        busy: busyGames.has(def.id),
      };
    }),
  );
}

/** Copies a cached game install into a brand-new server's content directory. No-op when this game
 *  has nothing cacheable, or nothing cached yet — the server then just downloads it the slow way,
 *  exactly as it did before this cache existed. */
export async function restoreCacheInto(gameId: string, destDir: string): Promise<boolean> {
  const def = getGameDefinition(gameId);
  if (!def.contentCache) return false;
  if (!(await hasCache(gameId))) return false;

  await fs.cp(cacheDirFor(gameId), destDir, { recursive: true, force: true });
  // The marker belongs to the cache's own bookkeeping, not to a real server's game directory.
  await fs.rm(path.join(destDir, '.outpost-cache-complete'), { force: true });
  return true;
}

/** Captures a finished install into the shared cache. Only ever called for a server that actually
 *  reached 'running', so the install is known-good rather than a half-downloaded directory. */
export async function saveCacheFrom(gameId: string, srcDir: string): Promise<void> {
  const def = getGameDefinition(gameId);
  if (!def.contentCache) return;

  const dest = cacheDirFor(gameId);
  // Copy into a scratch directory and swap it in only once it's complete, so an interrupted copy
  // can never leave a partially-written cache sitting where the next server create would find it.
  const staging = `${dest}.partial`;
  await fs.rm(staging, { recursive: true, force: true });
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.cp(srcDir, staging, { recursive: true });

  for (const relative of def.contentCache.exclude ?? []) {
    await fs.rm(path.join(staging, relative), { recursive: true, force: true });
  }

  await fs.writeFile(path.join(staging, '.outpost-cache-complete'), new Date().toISOString(), 'utf8');
  await fs.rm(dest, { recursive: true, force: true });
  await fs.rename(staging, dest);
}

export async function deleteCache(gameId: string): Promise<void> {
  await fs.rm(cacheDirFor(gameId), { recursive: true, force: true });
  await fs.rm(`${cacheDirFor(gameId)}.partial`, { recursive: true, force: true });
}

/** Where a given server keeps the content this game caches — null when the game has nothing
 *  cacheable at all. */
export function contentDirFor(gameId: string, dataPath: string): string | null {
  const def = getGameDefinition(gameId);
  if (!def.contentCache) return null;
  return path.join(dataPath, def.contentCache.subdir);
}

const PREWARM_TIMEOUT_MS = 90 * 60 * 1000;
const PREWARM_POLL_MS = 15_000;

/** Downloads a game's content up front, with no server attached, so the first real server someone
 *  creates starts instantly instead of sitting through a multi-GB Steam download. Works by booting
 *  a throwaway container exactly as a real server would, waiting for it to finish installing and
 *  come up, then capturing its content directory into the shared cache and tearing it down.
 *
 *  Detached and slow (tens of minutes for the bigger games) — callers get a "started" acknowledgement
 *  and poll listCaches() for the result. Never throws to the caller; a failure just leaves the game
 *  uncached, exactly as it was before. */
export function startPrewarm(gameId: string): void {
  const def = getGameDefinition(gameId);
  if (!def.contentCache || busyGames.has(gameId)) return;
  busyGames.add(gameId);

  void (async () => {
    const tempId = `prewarm-${crypto.randomUUID()}`;
    const dataPath = path.join(config.serversDir, tempId);
    let containerId: string | null = null;
    try {
      await fs.mkdir(dataPath, { recursive: true });
      const rconPassword = crypto.randomBytes(12).toString('hex');
      const spec = def.buildContainerSpec({
        name: 'Outpost prewarm',
        containerName: `outpost-${tempId}`,
        dataPath,
        memoryMb: 2048,
        variant: def.variants[0]!,
        version: '',
        rconPassword,
      });

      const hostPorts = await allocatePorts(spec.ports.length);
      const container = await createServerContainer(spec, hostPorts, { 'outpost.prewarm': gameId });
      containerId = container.id;
      await container.start();

      const rconIndex = spec.ports.findIndex((p) => p.purpose === 'rcon');
      const gameIndex = spec.ports.findIndex((p) => p.purpose === 'game');
      const deadline = Date.now() + PREWARM_TIMEOUT_MS;
      let installed = false;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, PREWARM_POLL_MS));
        const status = await getContainerStatus(containerId).catch(() => null);
        if (!status) break;
        const { readiness, confirmed } = await getServerReadiness(
          gameId,
          containerId,
          status.running,
          status.startedAt,
          hostPorts[gameIndex]!,
          rconIndex === -1 ? null : hostPorts[rconIndex]!,
          rconPassword,
          {
            exitCode: status.exitCode,
            oomKilled: status.oomKilled,
            deliberateStop: false,
            restartCount: status.restartCount,
          },
        );
        // Only a confirmed 'running' means the game itself actually came up — see the note in
        // readinessService on why the grace-period guess must not be trusted here.
        if (readiness === 'running' && confirmed) {
          installed = true;
          break;
        }
      }

      if (installed) {
        const contentDir = path.join(dataPath, def.contentCache!.subdir);
        await saveCacheFrom(gameId, contentDir);
      }
    } catch {
      await fs.rm(`${cacheDirFor(gameId)}.partial`, { recursive: true, force: true }).catch(() => undefined);
    } finally {
      if (containerId) await removeContainer(containerId).catch(() => undefined);
      await fs.rm(dataPath, { recursive: true, force: true }).catch(() => undefined);
      busyGames.delete(gameId);
    }
  })();
}

/** Fills an empty cache from the first server of that game to finish installing, so the next
 *  server created skips the multi-GB download entirely without anyone having to ask for it. Cheap
 *  to call repeatedly: it bails immediately once a cache exists. Detached, because copying several
 *  GB takes far longer than the status poll that triggers it. */
export function captureCacheIfEmpty(gameId: string, dataPath: string): void {
  const contentDir = contentDirFor(gameId, dataPath);
  if (!contentDir || busyGames.has(gameId)) return;

  void (async () => {
    if (await hasCache(gameId)) return;
    busyGames.add(gameId);
    try {
      await saveCacheFrom(gameId, contentDir);
    } catch {
      // A failed capture just means the next server downloads the game itself, same as before.
      await fs.rm(`${cacheDirFor(gameId)}.partial`, { recursive: true, force: true }).catch(() => undefined);
    } finally {
      busyGames.delete(gameId);
    }
  })();
}
