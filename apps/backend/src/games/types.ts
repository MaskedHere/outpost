/**
 * A "game definition" is the seam that lets Outpost support more than Minecraft later without
 * touching server-lifecycle/route code. Only `minecraft.ts` is implemented today; adding another
 * game means writing a new file that satisfies this interface and registering it in registry.ts.
 */
export interface CreateContainerSpec {
  image: string;
  containerName: string;
  env: string[];
  gamePort: number;
  hostPort: number;
  memoryMb: number;
  dataPath: string;
}

export interface GameDefinition {
  id: string;
  displayName: string;
  defaultGamePort: number;
  loaders: readonly string[];
  buildContainerSpec(input: {
    containerName: string;
    dataPath: string;
    hostPort: number;
    memoryMb: number;
    loader: string;
    version: string;
    /** Modrinth mods to install, pinned to an exact project+version pair. */
    modrinthMods?: { projectId: string; versionId: string }[];
  }): CreateContainerSpec;
}
