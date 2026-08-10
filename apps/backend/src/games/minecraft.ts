import type { GameDefinition } from './types.js';

// itzg/docker-minecraft-server: https://github.com/itzg/docker-minecraft-server
// Battle-tested image that already handles EULA, vanilla/Paper/Fabric/Forge/NeoForge/Quilt
// startup, JVM flags, and installing a list of Modrinth project versions via MODRINTH_PROJECTS.
// We deliberately don't reimplement any of that ourselves.
const IMAGE = 'itzg/minecraft-server:latest';

const LOADER_TO_TYPE: Record<string, string> = {
  vanilla: 'VANILLA',
  paper: 'PAPER',
  fabric: 'FABRIC',
  forge: 'FORGE',
  neoforge: 'NEOFORGE',
  quilt: 'QUILT',
};

export const minecraftDefinition: GameDefinition = {
  id: 'minecraft',
  displayName: 'Minecraft',
  defaultGamePort: 25565,
  loaders: ['vanilla', 'paper', 'fabric', 'forge', 'neoforge', 'quilt'],

  buildContainerSpec({ containerName, dataPath, hostPort, memoryMb, loader, version, modrinthMods }) {
    const type = LOADER_TO_TYPE[loader];
    if (!type) {
      throw new Error(`Unknown Minecraft loader: ${loader}`);
    }

    const env = [
      'EULA=TRUE',
      `TYPE=${type}`,
      `VERSION=${version}`,
      `MEMORY=${memoryMb}M`,
      // We resolve dependency versions ourselves (see modrinth/dependencies.ts), so tell the
      // image not to try to resolve them again on its own.
      'MODRINTH_DOWNLOAD_DEPENDENCIES=none',
    ];

    if (modrinthMods && modrinthMods.length > 0) {
      // itzg's image expects each entry as "<project id>:<version id>", not a bare version id.
      env.push(`MODRINTH_PROJECTS=${modrinthMods.map((m) => `${m.projectId}:${m.versionId}`).join(',')}`);
    }

    return {
      image: IMAGE,
      containerName,
      env,
      gamePort: 25565,
      hostPort,
      memoryMb,
      dataPath,
    };
  },
};
