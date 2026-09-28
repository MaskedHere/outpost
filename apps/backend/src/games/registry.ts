import type { GameDefinition } from './types.js';
import { minecraftDefinition } from './minecraft.js';
import { terrariaDefinition } from './terraria.js';
import { factorioDefinition } from './factorio.js';
import { valheimDefinition } from './valheim.js';
import { tf2Definition } from './tf2.js';
import { sevenDaysToDieDefinition } from './sevendaystodie.js';
import { projectZomboidDefinition } from './projectzomboid.js';
import { palworldDefinition } from './palworld.js';
import { bedrockDefinition } from './bedrock.js';

const registry: Record<string, GameDefinition> = {
  minecraft: minecraftDefinition,
  terraria: terrariaDefinition,
  factorio: factorioDefinition,
  valheim: valheimDefinition,
  tf2: tf2Definition,
  '7dtd': sevenDaysToDieDefinition,
  zomboid: projectZomboidDefinition,
  palworld: palworldDefinition,
  bedrock: bedrockDefinition,
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
