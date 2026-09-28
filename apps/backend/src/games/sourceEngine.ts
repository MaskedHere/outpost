import type { PlayerRef } from './types.js';

/** Parses the Source engine `status` command output (used by TF2). */
export function parseSourceStatus(output: string): {
  players: PlayerRef[];
  max: number | null;
  map: string | null;
} {
  const players: PlayerRef[] = [];
  for (const line of output.split('\n')) {
    // Player detection only needs the userid/name/steamid prefix.
    const match = line.match(/^#?\s*\d+\s+"(.+?)"\s+(\S+)(.*)$/);
    if (!match) continue;
    // Ping is the first integer field after the connected-time column, e.g. "00:12:34   65    0  active".
    const pingMatch = match[3]?.trim().match(/^\S+\s+(\d+)/);
    players.push({
      name: match[1]!,
      id: match[2]!,
      ping: pingMatch ? Number(pingMatch[1]) : undefined,
    });
  }
  const capMatch = output.match(/\((\d+)\s*max\)/i);
  // The "map" header line is one of the most stable parts of Source engine's status format, e.g.
  // "map     : cp_badlands at: 0 x, 0 y, 0 z".
  const mapMatch = output.match(/^map\s*:\s*(\S+)/im);
  return { players, max: capMatch ? Number(capMatch[1]) : null, map: mapMatch?.[1] ?? null };
}
