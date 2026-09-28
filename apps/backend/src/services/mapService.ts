import { config } from '../config.js';
import { rconExec } from '../rcon/client.js';
import { getGameDefinition } from '../games/registry.js';
import { PlayersUnsupportedError } from './playersService.js';

/** Reuses the same RCON status/list call players.ts already makes. */
export async function getCurrentMap(
  gameId: string,
  rconPort: number | null,
  rconPassword: string | null,
): Promise<string | null> {
  if (!rconPort || !rconPassword) return null;
  const def = getGameDefinition(gameId);
  if (!def.players) return null;

  try {
    const output = await rconExec(
      config.rconHost,
      rconPort,
      rconPassword,
      def.players.list.command,
      4000,
    );
    return def.players.list.parse(output).map ?? null;
  } catch {
    return null;
  }
}

export async function changeMap(
  gameId: string,
  rconPort: number | null,
  rconPassword: string | null,
  map: string,
): Promise<void> {
  const def = getGameDefinition(gameId);
  if (!def.mapControl)
    throw new PlayersUnsupportedError('This game has no live map switching support');
  if (!(map in def.mapControl.options)) throw new PlayersUnsupportedError('Unknown map');
  if (!rconPort || !rconPassword)
    throw new PlayersUnsupportedError('This server has no RCON console');

  await rconExec(config.rconHost, rconPort, rconPassword, def.mapControl.changeCommand(map));
}
