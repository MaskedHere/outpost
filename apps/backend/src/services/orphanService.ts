import path from 'node:path';
import fs from 'node:fs/promises';
import { prisma } from '../db/client.js';
import { config } from '../config.js';
import { getGameDefinition } from '../games/registry.js';
import { createServerContainer } from '../docker/containers.js';
import { allocatePorts } from '../docker/ports.js';
import crypto from 'node:crypto';

/** Finds and reclaims server data directories that no longer belong to any server. */

/** A signature that identifies which game a directory belonged to. */
interface Signature {
  game: string;
  /** Every path (relative to the directory) that must exist for this to match. */
  requires: string[];
}

const SIGNATURES: Signature[] = [
  // Distinctive single files first.
  { game: 'palworld', requires: ['Pal'] },
  { game: 'factorio', requires: ['config/server-settings.json'] },
  { game: 'terraria', requires: ['tModLoader'] },
  { game: 'terraria', requires: ['serverconfig.txt'] },
  { game: 'bedrock', requires: ['worlds'] },
  { game: 'minecraft', requires: ['eula.txt'] },
  // Two-volume SteamCMD games share `steamcmd/` + `server/`, so they're told apart by what's
  // inside `server/` rather than by the shape alone.
  { game: '7dtd', requires: ['server/serverconfig.xml'] },
  { game: 'zomboid', requires: ['server/ProjectZomboid64'] },
  { game: 'valheim', requires: ['server/valheim_server.x86_64'] },
  // Weaker fallbacks, only reached when nothing above matched.
  { game: 'zomboid', requires: ['config/Server'] },
  { game: 'minecraft', requires: ['server.properties'] },
];

export interface OrphanDir {
  /** The directory name, which is also the id the restored server will take so its data path is
   *  reused exactly rather than copied. */
  id: string;
  sizeBytes: number;
  modifiedAt: string;
  /** Best guess at which game left this behind, or null when nothing matched. */
  guessedGame: string | null;
  guessedGameName: string | null;
  /** Top-level entries, so someone can recognise a directory the guess couldn't identify. */
  sample: string[];
  /** True when the directory holds nothing at all. */
  empty: boolean;
}

async function exists(p: string): Promise<boolean> {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false);
}

async function guessGame(dir: string): Promise<string | null> {
  for (const signature of SIGNATURES) {
    const all = await Promise.all(signature.requires.map((rel) => exists(path.join(dir, rel))));
    if (all.every(Boolean)) return signature.game;
  }
  return null;
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

/** Every directory under serversDir with no GameServer row pointing at it. */
export async function listOrphans(): Promise<OrphanDir[]> {
  const entries = await fs.readdir(config.serversDir, { withFileTypes: true }).catch(() => []);
  const known = new Set(
    (await prisma.gameServer.findMany({ select: { id: true } })).map((s) => s.id),
  );

  const orphans: OrphanDir[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || known.has(entry.name)) continue;
    const dir = path.join(config.serversDir, entry.name);
    const [size, stat, guessed, sample] = await Promise.all([
      dirSize(dir),
      fs.stat(dir).catch(() => null),
      guessGame(dir),
      fs.readdir(dir).catch(() => [] as string[]),
    ]);
    orphans.push({
      id: entry.name,
      sizeBytes: size,
      modifiedAt: (stat?.mtime ?? new Date(0)).toISOString(),
      guessedGame: guessed,
      guessedGameName: guessed ? getGameDefinition(guessed).displayName : null,
      sample: sample.slice(0, 8),
      empty: sample.length === 0,
    });
  }
  // Largest first, since reclaiming space is the goal.
  return orphans.sort((a, b) => b.sizeBytes - a.sizeBytes);
}

export async function deleteOrphan(id: string): Promise<void> {
  // Guard against a caller reaching outside serversDir with a crafted id.
  const dir = path.join(config.serversDir, id);
  const relative = path.relative(config.serversDir, dir);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Invalid directory');
  }
  const stillOwned = await prisma.gameServer.findUnique({ where: { id } });
  if (stillOwned) throw new Error('That directory belongs to an existing server');
  await fs.rm(dir, { recursive: true, force: true });
}

export class OrphanRestoreError extends Error {}

/** Rebuilds a server around an existing orphaned directory. */
export async function restoreOrphan(input: {
  id: string;
  game: string;
  name: string;
  variant?: string;
  version?: string;
  memoryMb: number;
}) {
  const dataPath = path.join(config.serversDir, input.id);
  if (!(await exists(dataPath))) throw new OrphanRestoreError('That directory no longer exists');
  if (await prisma.gameServer.findUnique({ where: { id: input.id } })) {
    throw new OrphanRestoreError('That directory already belongs to a server');
  }

  const gameDef = getGameDefinition(input.game);
  const variant = input.variant || gameDef.variants[0]!;
  if (!gameDef.variants.includes(variant)) {
    throw new OrphanRestoreError(`Unsupported variant for ${gameDef.displayName}: ${variant}`);
  }

  const containerName = `outpost-${input.id}`;
  const rconPassword = crypto.randomBytes(12).toString('hex');
  const spec = gameDef.buildContainerSpec({
    name: input.name,
    containerName,
    dataPath,
    memoryMb: input.memoryMb,
    variant,
    version: input.version ?? '',
    rconPassword,
  });

  const hostPorts = await allocatePorts(spec.ports.length);
  const gamePortIndex = spec.ports.findIndex((p) => p.purpose === 'game');
  const rconPortIndex = spec.ports.findIndex((p) => p.purpose === 'rcon');
  if (gamePortIndex === -1) throw new OrphanRestoreError(`${gameDef.displayName} has no game port`);

  let containerId: string;
  try {
    const container = await createServerContainer(spec, hostPorts, {
      'outpost.serverId': input.id,
    });
    containerId = container.id;
  } catch (err) {
    // Unlike a fresh create, the data directory is NOT removed on failure.
    throw new OrphanRestoreError(
      `Failed to create the container: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return prisma.gameServer.create({
    data: {
      id: input.id,
      name: input.name,
      game: input.game,
      variant,
      version: input.version ?? '',
      containerId,
      containerName,
      gamePort: hostPorts[gamePortIndex]!,
      rconPort: rconPortIndex === -1 ? null : hostPorts[rconPortIndex]!,
      rconPassword,
      memoryMb: input.memoryMb,
      dataPath,
    },
  });
}
