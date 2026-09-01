import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { rconExec } from '../rcon/client.js';

// itzg's image writes/maintains this directly in the bind-mounted data dir — same file the server
// itself reads on boot and keeps in sync when difficulty/gamemode/whitelist change via command, so
// reading it works even while the server's offline, and writing it is what makes a change stick
// across a restart (the matching RCON command below is just for taking effect immediately too).
const PROPERTIES_FILE = 'server.properties';

export type Difficulty = 'peaceful' | 'easy' | 'normal' | 'hard';
export type Gamemode = 'survival' | 'creative' | 'adventure' | 'spectator';

export interface WorldSettings {
  levelName: string;
  difficulty: Difficulty;
  gamemode: Gamemode;
  hardcore: boolean;
  whitelist: boolean;
}

async function readProperties(dataPath: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const raw = await fs.readFile(path.join(dataPath, PROPERTIES_FILE), 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      map.set(trimmed.slice(0, idx).trim(), trimmed.slice(idx + 1).trim());
    }
  } catch {
    // No properties file yet (server's never booted) — every setting just falls back to its
    // vanilla default below.
  }
  return map;
}

/** Rewrites a single key's value in-place, preserving every other line exactly (comments, ordering,
 *  the works) — appends the key if it wasn't already present. */
async function writeProperty(dataPath: string, key: string, value: string): Promise<void> {
  const file = path.join(dataPath, PROPERTIES_FILE);
  let lines: string[];
  try {
    lines = (await fs.readFile(file, 'utf8')).split('\n');
  } catch {
    lines = [];
  }

  let found = false;
  const next = lines.map((line) => {
    const trimmed = line.trim();
    if (!found && !trimmed.startsWith('#') && trimmed.startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) next.push(`${key}=${value}`);

  await fs.writeFile(file, next.join('\n'), 'utf8');
}

export async function readWorldSettings(dataPath: string): Promise<WorldSettings> {
  const props = await readProperties(dataPath);
  return {
    levelName: props.get('level-name') || 'world',
    difficulty: (props.get('difficulty') as Difficulty) || 'easy',
    gamemode: (props.get('gamemode') as Gamemode) || 'survival',
    hardcore: props.get('hardcore') === 'true',
    whitelist: props.get('white-list') === 'true',
  };
}

/** Applies a setting both ways: writes it to server.properties (so it's what the server actually
 *  boots with next time) and, if the server's currently up, fires the matching RCON command too so
 *  it takes effect immediately instead of waiting for a restart. */
export async function updateWorldSetting(
  dataPath: string,
  rconPort: number | null,
  rconPassword: string | null,
  update: { difficulty?: Difficulty } | { gamemode?: Gamemode } | { whitelist?: boolean },
): Promise<void> {
  const isRunning = Boolean(rconPort && rconPassword);

  if ('difficulty' in update && update.difficulty) {
    await writeProperty(dataPath, 'difficulty', update.difficulty);
    if (isRunning) await rconExec(config.rconHost, rconPort!, rconPassword!, `difficulty ${update.difficulty}`).catch(() => undefined);
  }
  if ('gamemode' in update && update.gamemode) {
    await writeProperty(dataPath, 'gamemode', update.gamemode);
    if (isRunning) await rconExec(config.rconHost, rconPort!, rconPassword!, `defaultgamemode ${update.gamemode}`).catch(() => undefined);
  }
  if ('whitelist' in update && update.whitelist !== undefined) {
    await writeProperty(dataPath, 'white-list', String(update.whitelist));
    if (isRunning) {
      await rconExec(config.rconHost, rconPort!, rconPassword!, `whitelist ${update.whitelist ? 'on' : 'off'}`).catch(() => undefined);
    }
  }
}

// A small, deliberately short list of the gamerules people actually ask for on a casual server —
// not the full ~30+ vanilla has. Each is one RCON round trip to read (querying a gamerule with no
// value is how vanilla reports its current one) and one to set.
export const GAMERULES = ['keepInventory', 'doDaylightCycle', 'doWeatherCycle', 'doMobSpawning'] as const;
export type Gamerule = (typeof GAMERULES)[number];

export async function readGamerules(rconPort: number, rconPassword: string): Promise<Record<Gamerule, boolean | null>> {
  const entries = await Promise.all(
    GAMERULES.map(async (rule) => {
      try {
        const output = await rconExec(config.rconHost, rconPort, rconPassword, `gamerule ${rule}`, 3000);
        const match = output.match(/:\s*(true|false)/i);
        return [rule, match ? match[1]!.toLowerCase() === 'true' : null] as const;
      } catch {
        return [rule, null] as const;
      }
    }),
  );
  return Object.fromEntries(entries) as Record<Gamerule, boolean | null>;
}

export async function setGamerule(rconPort: number, rconPassword: string, rule: Gamerule, value: boolean): Promise<void> {
  await rconExec(config.rconHost, rconPort, rconPassword, `gamerule ${rule} ${value}`);
}

/** Deletes the overworld/nether/end save folders so the server generates a brand new world on its
 *  next boot — everything else (config, mods, plugins) is untouched. Caller is responsible for
 *  making sure the server's actually stopped first; deleting a world's files out from under a
 *  running process is exactly the kind of thing that corrupts a save. */
export async function deleteWorld(dataPath: string, levelName: string): Promise<void> {
  const dirs = [levelName, `${levelName}_nether`, `${levelName}_the_end`];
  await Promise.all(dirs.map((dir) => fs.rm(path.join(dataPath, dir), { recursive: true, force: true })));
}
