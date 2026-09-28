/**
 * A "game definition" is the seam that lets Outpost support many games without touching
 * server-lifecycle/route code.
 */
export interface PortSpec {
  /** The port as the game process itself listens on it, inside the container. */
  containerPort: number;
  protocol: 'tcp' | 'udp';
  /** 'game' becomes GameServer.gamePort, 'rcon' becomes rconPort, 'extra' is just published. */
  purpose: 'game' | 'rcon' | 'extra';
}

export interface VolumeSpec {
  /** Subdirectory under the server's dataPath on the host; '' mounts dataPath itself. */
  hostSubdir: string;
  containerPath: string;
}

/** Identifies a connected or banned player. */
export interface PlayerRef {
  name: string;
  id: string;
  /**
   * Latency in ms, only when the RCON dialect reports it (Source `status` does; Minecraft `list`
   * doesn't).
   */
  ping?: number;
  /** Minecraft-only: whether they're currently a server operator, read from ops.json. */
  isOp?: boolean;
}

/** One user-facing knob on a server's Settings tab. */
export interface GameSettingField {
  key: string;
  label: string;
  /** Shown behind the ⓘ. */
  info: string;
  type: 'toggle' | 'number' | 'select' | 'text';
  /** Applied when the user hasn't chosen anything. */
  default: string;
  /** toggle: the stored value each position maps to. */
  onValue?: string;
  offValue?: string;
  /** number: inclusive bounds, enforced in the UI and re-checked on save. */
  min?: number;
  max?: number;
  /** select: the allowed values, in display order. */
  options?: { value: string; label: string }[];
  /** Optional heading to group related fields under in the UI. */
  group?: string;
  /** Set for settings that only take effect on a world/save that doesn't exist yet. */
  newWorldOnly?: boolean;
}

export interface CreateContainerSpec {
  image: string;
  containerName: string;
  env: string[];
  /**
   * Extra launch args appended to the entrypoint (mainly Source-engine servers, where the RCON
   * password is a `+rcon_password` arg).
   */
  cmd?: string[];
  ports: PortSpec[];
  /** Most games are one bind mount; a few (7 Days to Die, Project Zomboid) split install data
   *  from config/saves across two container paths. */
  volumes: VolumeSpec[];
  memoryMb: number;
  dataPath: string;
  /** Runs after volume directories exist but before the container is created. */
  preCreate?: (hostPaths: Record<string, string>) => Promise<void>;
}

export interface GameDefinition {
  id: string;
  displayName: string;
  /** Server flavors a user picks from. */
  variants: readonly string[];
  /**
   * Display text per variant, e.g. "CTF — 2Fort" instead of "ctf_2fort". Falls back to the raw
   * variant.
   */
  variantLabels?: Record<string, string>;
  /** Overrides the generic "Variant" label on the wizard's picker (e.g. "Map" for TF2). */
  variantFieldLabel?: string;
  /** Label for the wizard's version input, or null when this game has no user-facing version field. */
  versionLabel: string | null;
  versionPlaceholder?: string;
  /** Whether this game has a mod-install flow in Outpost's server creation wizard. */
  moddable: boolean;
  /** Which content system backs the "Modded" choice. */
  moddingKind?: 'minecraft' | 'workshop-items';
  /** Which variants count as "modded" for the Minecraft-style loader picker (ignored otherwise). */
  moddedVariants?: readonly string[];
  /** moddingKind: 'workshop-items' only. */
  workshopRequiresModIds?: boolean;
  /** Steam App ID, if this game is distributed on Steam. */
  steamAppId?: number;
  /**
   * The app whose Steam Workshop holds this game's mods, when that differs from the game itself.
   * tModLoader is the case that forces this to exist: Terraria is app 105600, but its mods are
   * published under tModLoader's own app (1281930), so searching by steamAppId would find nothing.
   */
  workshopAppId?: number;
  /** Protocol of this game's main 'game' port. */
  gamePortProtocol: 'tcp' | 'udp';
  /**
   * Set for games whose image downloads the whole game from Steam on every first boot (the
   * SteamCMD-backed images, often several GB).
   */
  contentCache?: {
    /** Which VolumeSpec.hostSubdir holds the cacheable content. */
    subdir: string;
    /** Rough download size, for the UI to set expectations before a prewarm. */
    approxSizeLabel: string;
    /**
     * Paths inside `subdir` that are per-server state rather than shared content, and so must never
     * be captured into (or restored from) the shared cache.
     */
    exclude?: string[];
  };
  /**
   * Matched against recent container logs to tell "container running" apart from "world/map
   * finished loading and is accepting players".
   */
  readyLogPattern?: RegExp;
  /**
   * Matched against recent container logs to catch a distinct "actively installing" phase before
   * the game process itself has even started (e.g. a modded Minecraft server's loader installer
   * fetching a hundred-odd library jars, or Modrinth mod downloads)
   */
  installingLogPattern?: RegExp;
  /** Server options this game exposes on the Settings tab. */
  settings?: GameSettingField[];
  /** RCON-backed player management. */
  players?: {
    /** Lists currently-connected players. */
    list: {
      command: string;
      /** `map` is the currently-loaded map/level, only when the RCON response happens to report
       *  one (Source engine's `status` does). */
      parse(output: string): { players: PlayerRef[]; max: number | null; map?: string | null };
    };
    /** Returns the RCON command string to run. */
    kick(player: PlayerRef): string;
    ban(player: PlayerRef): string;
    /** Not every RCON dialect exposes a real "kill this specific player" command. */
    kill?(player: PlayerRef): string;
    /** Banned players aren't connected, so listing/lifting bans needs its own query. */
    banned?: { command: string; parse(output: string): PlayerRef[] };
    unban?(player: PlayerRef): string;
    /**
     * Grants/revokes server operator status. Minecraft-only (`op`/`deop`); omitted where it doesn't
     * apply.
     */
    op?(player: PlayerRef): string;
    deop?(player: PlayerRef): string;
  };
  /**
   * Lets the Settings tab change the running server's map/level live over RCON instead of
   * recreating the container.
   */
  mapControl?: {
    /** Value -> display label, e.g. "cp_badlands" -> "Control Point — Badlands". */
    options: Record<string, string>;
    changeCommand(map: string): string;
  };
  buildContainerSpec(input: {
    /** The user's friendly server name. */
    name: string;
    containerName: string;
    dataPath: string;
    memoryMb: number;
    variant: string;
    version: string;
    /** Every server gets one, whether or not the game has RCON. */
    rconPassword: string;
    /** Modrinth mods to install, pinned to an exact project+version pair. */
    modrinthMods?: { projectId: string; versionId: string }[];
    /** Steam Workshop item IDs. */
    workshopItemIds?: string[];
    /** The mod's own internal ID (from its mod.info/modinfo.txt), same order as workshopItemIds. */
    modIds?: string[];
    /** Message of the day, where the game supports one. */
    motd?: string;
    /**
     * Extra per-game behavior settings a def opts into supporting (Minecraft: itzg env-var-style
     * keys like ALLOW_FLIGHT, PVP, DIFFICULTY straight through)
     */
    extraSettings?: Record<string, string>;
  }): CreateContainerSpec;
}
