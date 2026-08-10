import type { GameDefinition } from './types.js';
import { minecraftDefinition } from './minecraft.js';

const registry: Record<string, GameDefinition> = {
  minecraft: minecraftDefinition,
};

export function getGameDefinition(gameId: string): GameDefinition {
  const def = registry[gameId];
  if (!def) {
    throw new Error(`Unsupported game: ${gameId}`);
  }
  return def;
}

export function listGameDefinitions(): GameDefinition[] {
  return Object.values(registry);
}
