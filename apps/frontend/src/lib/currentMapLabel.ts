import type { GameDef, GameServer } from './api';

/** For games with live map switching (TF2), the server's `variant` only reflects whatever map it
 *  was originally created with — it goes stale the moment someone switches maps from Settings.
 *  Prefer the actually-loaded map (server.players.map, refreshed on the same poll as everything
 *  else) when it's known and resolvable to a friendly label; null otherwise so callers fall back to
 *  showing the variant like before. */
export function currentMapLabel(server: GameServer, gameDef: GameDef | undefined): string | null {
  const map = server.players?.map;
  if (!map) return null;
  const optionLabel = gameDef?.mapOptions?.[map];
  if (!optionLabel) return null;
  const sep = optionLabel.indexOf(' — ');
  return sep === -1 ? optionLabel : optionLabel.slice(sep + 3);
}
