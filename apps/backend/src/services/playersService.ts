import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { rconExec } from '../rcon/client.js';
import { getGameDefinition } from '../games/registry.js';
import { prisma } from '../db/client.js';
import type { PlayerRef } from '../games/types.js';

export class PlayersUnsupportedError extends Error {}

function requireRcon(rconPort: number | null, rconPassword: string | null): { port: number; password: string } {
  if (!rconPort || !rconPassword) throw new PlayersUnsupportedError('This server has no RCON console');
  return { port: rconPort, password: rconPassword };
}

/** The bare RCON player list — no Minecraft op-status augmentation, no sighting side effect.
 *  Shared by listPlayers (which adds both) and listOfflineSeenPlayers (which just needs the ids to
 *  exclude, and would otherwise double-record every online player it's about to filter out). */
async function getRawOnlinePlayers(gameId: string, rconPort: number | null, rconPassword: string | null): Promise<PlayerRef[]> {
  const def = getGameDefinition(gameId);
  if (!def.players) throw new PlayersUnsupportedError('This game has no player management support');
  const { port, password } = requireRcon(rconPort, rconPassword);
  const output = await rconExec(config.rconHost, port, password, def.players.list.command);
  return def.players.list.parse(output).players;
}

/** Upserts a "seen this player" record for everyone RCON reports online right now — the running
 *  log the Players tab's "Offline" view reads from, so someone who caused trouble and disconnected
 *  before an admin could act can still be found and banned by name/SteamID afterward. Best-effort:
 *  a failed write here should never break the player list/count it rode in on. */
async function recordSightings(serverId: string, players: PlayerRef[]): Promise<void> {
  if (players.length === 0) return;
  await Promise.all(
    players.map((p) =>
      prisma.playerSighting
        .upsert({
          where: { serverId_playerId: { serverId, playerId: p.id } },
          create: { serverId, playerId: p.id, playerName: p.name },
          update: { playerName: p.name, lastSeenAt: new Date() },
        })
        .catch(() => undefined),
    ),
  );
}

export interface PlayerSummary {
  current: number;
  /** Null when this game's RCON dialect doesn't report a player cap. */
  max: number | null;
  /** Currently-loaded map/level, only when the RCON dialect reports one (Source engine's `status`
   *  does) — rides along on the same call rather than costing a second RCON round trip. */
  map: string | null;
}

// Every open Dashboard/ServerDetail tab polls this every few seconds, and each call is a fresh
// RCON connect/auth/exec/disconnect — which most game servers (Minecraft included) log a line for
// on both ends. A short cache means several concurrent pollers share one real RCON round trip
// instead of each opening their own, without making the displayed count noticeably stale.
const SUMMARY_CACHE_TTL_MS = 8000;
const summaryCache = new Map<number, { data: PlayerSummary | null; expires: number }>();

/** null means "unknown" (no RCON, no player-list support, server not ready, or an unparseable
 *  response) — never a guessed 0/0. Callers should render that as a dash. */
export async function getPlayerSummary(
  gameId: string,
  serverId: string,
  rconPort: number | null,
  rconPassword: string | null,
): Promise<PlayerSummary | null> {
  if (!rconPort || !rconPassword) return null;
  const def = getGameDefinition(gameId);
  if (!def.players) return null;

  const cached = summaryCache.get(rconPort);
  if (cached && cached.expires > Date.now()) return cached.data;

  let result: PlayerSummary | null;
  try {
    const output = await rconExec(config.rconHost, rconPort, rconPassword, def.players.list.command, 4000);
    const { players, max, map } = def.players.list.parse(output);
    result = { current: players.length, max, map: map ?? null };
    await recordSightings(serverId, players);
  } catch {
    result = null;
  }
  summaryCache.set(rconPort, { data: result, expires: Date.now() + SUMMARY_CACHE_TTL_MS });
  return result;
}

/** Reads Minecraft's own ops.json (kept in sync by the server itself on every op/deop) to report
 *  each player's real operator status — RCON has no query command for this, so the file is the
 *  only source of truth. Missing/unreadable/malformed file just means "nobody's an op yet". */
async function readMinecraftOps(dataPath: string): Promise<Set<string>> {
  try {
    const raw = await fs.readFile(path.join(dataPath, 'ops.json'), 'utf8');
    const entries = JSON.parse(raw) as { name?: string }[];
    return new Set(entries.map((e) => e.name).filter((name): name is string => Boolean(name)));
  } catch {
    return new Set();
  }
}

export async function listPlayers(
  gameId: string,
  serverId: string,
  rconPort: number | null,
  rconPassword: string | null,
  dataPath: string,
): Promise<PlayerRef[]> {
  const players = await getRawOnlinePlayers(gameId, rconPort, rconPassword);
  await recordSightings(serverId, players);
  if (gameId !== 'minecraft') return players;

  const ops = await readMinecraftOps(dataPath);
  return players.map((p) => ({ ...p, isOp: ops.has(p.name) }));
}

/** Everyone RCON has ever reported connected to this server, minus whoever's online right now and
 *  minus anyone already banned — the pool the "Offline" tab shows, so a player who left before an
 *  admin could act is still findable (and still bannable, by the same stored name/id) afterward. */
export async function listOfflineSeenPlayers(
  gameId: string,
  serverId: string,
  rconPort: number | null,
  rconPassword: string | null,
): Promise<(PlayerRef & { lastSeenAt: string })[]> {
  const sightings = await prisma.playerSighting.findMany({ where: { serverId }, orderBy: { lastSeenAt: 'desc' } });

  let onlineIds = new Set<string>();
  let bannedIds = new Set<string>();
  try {
    onlineIds = new Set((await getRawOnlinePlayers(gameId, rconPort, rconPassword)).map((p) => p.id));
  } catch {
    // Server unreachable/offline — fall through and show the full sighting log rather than none.
  }
  try {
    bannedIds = new Set((await listBannedPlayers(gameId, rconPort, rconPassword)).map((p) => p.id));
  } catch {
    // This game has no ban-list support (or the call failed) — nothing to exclude on that front.
  }

  return sightings
    .filter((s) => !onlineIds.has(s.playerId) && !bannedIds.has(s.playerId))
    .map((s) => ({ name: s.playerName, id: s.playerId, lastSeenAt: s.lastSeenAt.toISOString() }));
}

export async function listBannedPlayers(
  gameId: string,
  rconPort: number | null,
  rconPassword: string | null,
): Promise<PlayerRef[]> {
  const def = getGameDefinition(gameId);
  if (!def.players?.banned) throw new PlayersUnsupportedError('This game has no ban list support');
  const { port, password } = requireRcon(rconPort, rconPassword);
  const output = await rconExec(config.rconHost, port, password, def.players.banned.command);
  return def.players.banned.parse(output);
}

export type PlayerAction = 'kick' | 'ban' | 'kill' | 'unban' | 'op' | 'deop';

export async function runPlayerAction(
  gameId: string,
  rconPort: number | null,
  rconPassword: string | null,
  action: PlayerAction,
  player: PlayerRef,
): Promise<void> {
  const def = getGameDefinition(gameId);
  const buildCommand = def.players?.[action];
  if (!def.players || !buildCommand) {
    throw new PlayersUnsupportedError(`This game doesn't support ${action}`);
  }
  const { port, password } = requireRcon(rconPort, rconPassword);
  await rconExec(config.rconHost, port, password, buildCommand(player));
}
