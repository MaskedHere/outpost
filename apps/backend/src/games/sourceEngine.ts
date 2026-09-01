import type { PlayerRef } from './types.js';

/** Shared by every Source-engine game (GMod, TF2) — they all answer RCON `status` with the same
 *  shape: a header block (hostname/version/udp-ip/map/players), then one row per connected player
 *  like `#      2 "PlayerName"        STEAM_0:1:12345678   00:12   34    0  active`
 *  (userid, name, steamid, connected time, ping, loss, state). */
export function parseSourceStatus(output: string): { players: PlayerRef[]; max: number | null; map: string | null } {
  const players: PlayerRef[] = [];
  for (const line of output.split('\n')) {
    // Player detection only needs the userid/name/steamid prefix — kept loose so a player is never
    // dropped from the list just because the trailing connected-time/ping/loss/state columns don't
    // line up exactly as expected.
    const match = line.match(/^#?\s*\d+\s+"(.+?)"\s+(\S+)(.*)$/);
    if (!match) continue;
    // Ping is the first integer field after the connected-time column, e.g. "00:12:34   65    0  active".
    const pingMatch = match[3]?.trim().match(/^\S+\s+(\d+)/);
    players.push({ name: match[1]!, id: match[2]!, ping: pingMatch ? Number(pingMatch[1]) : undefined });
  }
  const capMatch = output.match(/\((\d+)\s*max\)/i);
  // The "map" header line is one of the most stable parts of Source engine's status format, e.g.
  // "map     : cp_badlands at: 0 x, 0 y, 0 z" — stop at whitespace/"at:" so only the map name itself
  // is captured.
  const mapMatch = output.match(/^map\s*:\s*(\S+)/im);
  return { players, max: capMatch ? Number(capMatch[1]) : null, map: mapMatch?.[1] ?? null };
}
