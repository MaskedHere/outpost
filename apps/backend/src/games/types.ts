/**
 * A "game definition" is the seam that lets Outpost support many games without touching
 * server-lifecycle/route code. Each implements this interface and registers in registry.ts.
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

/** Identifies a connected or banned player. `id` is whatever token the game's own admin commands
 *  actually need to target them — a name for Minecraft/Factorio, a SteamID for Source engine. */
export interface PlayerRef {
  name: string;
  id: string;
  /** Milliseconds of latency, only when the RCON dialect actually reports it (Source engine's
   *  `status` does; vanilla Minecraft's `list` doesn't expose ping at all — no client command
   *  surfaces it, so it's just omitted there rather than faked). */
  ping?: number;
  /** Minecraft-only: whether they're currently a server operator, read from ops.json — lets the
   *  UI show only Op or only De-op instead of both, always. Undefined for games without the
   *  concept. */
  isOp?: boolean;
}

/** One user-facing knob on a server's Settings tab. Declared per game rather than hardcoded in the
 *  frontend so a game def owns both the option and the code that applies it — the UI just renders
 *  whatever the def declares. Values are always stored as strings (they live in the JSON-encoded
 *  GameServer.extraSettings blob); each def converts them to whatever its image actually wants —
 *  an env var, a launch arg, or a line in a config file. */
export interface GameSettingField {
  key: string;
  label: string;
  /** Shown behind the ⓘ — say what it actually does and when someone would want it, not just a
   *  restatement of the label. */
  info: string;
  type: 'toggle' | 'number' | 'select' | 'text';
  /** Applied when the user hasn't chosen anything. Matches the underlying game's own default
   *  wherever possible, so an untouched Outpost server behaves like a stock one. */
  default: string;
  /** toggle: the stored value each position maps to. Some settings are inverted or numeric (e.g.
   *  Minecraft's spawn protection is a radius, where "off" is 0), so this isn't always true/false. */
  onValue?: string;
  offValue?: string;
  /** number: inclusive bounds, enforced in the UI and re-checked on save. */
  min?: number;
  max?: number;
  /** select: the allowed values, in display order. */
  options?: { value: string; label: string }[];
  /** Optional heading to group related fields under in the UI. */
  group?: string;
  /** Set for settings that only take effect on a world/save that doesn't exist yet — changing one
   *  on a server that already generated its world does nothing until the world is recreated, so the
   *  UI says so rather than letting someone think it silently failed. */
  newWorldOnly?: boolean;
}

export interface CreateContainerSpec {
  image: string;
  containerName: string;
  env: string[];
  /** Extra launch args appended to the container's entrypoint, for images configured this way
   *  (mainly Source-engine servers, where e.g. RCON password is a `+rcon_password` launch arg
   *  rather than an environment variable). */
  cmd?: string[];
  ports: PortSpec[];
  /** Most games are one bind mount; a few (7 Days to Die, Project Zomboid) split install data
   *  from config/saves across two container paths. */
  volumes: VolumeSpec[];
  memoryMb: number;
  dataPath: string;
  /** Runs after volume directories exist but before the container is created — for games (like
   *  Factorio) that only pick up a generated secret from a config file already being present on
   *  first boot, rather than an environment variable. Receives each volume's *host* path. */
  preCreate?: (hostPaths: Record<string, string>) => Promise<void>;
}

export interface GameDefinition {
  id: string;
  displayName: string;
  /** Server flavors a user picks from — e.g. vanilla/paper/fabric for Minecraft. Games without a
   *  meaningful choice expose a single entry (by convention, 'default'). For games where "variant"
   *  is really a map choice (TF2), each entry is the literal map filename passed to the server. */
  variants: readonly string[];
  /** Friendlier display text per variant, e.g. "CTF — 2Fort" instead of the raw "ctf_2fort" map
   *  filename. Falls back to the raw variant string in the UI when a variant has no entry here. */
  variantLabels?: Record<string, string>;
  /** Overrides the generic "Variant" label on the wizard's picker (e.g. "Map" for TF2). */
  variantFieldLabel?: string;
  /** Label for the wizard's version input, or null when this game has no user-facing version field. */
  versionLabel: string | null;
  versionPlaceholder?: string;
  /** Whether this game has a mod-install flow in Outpost's server creation wizard. */
  moddable: boolean;
  /** Which content system backs the "Modded" choice — each needs a different wizard step.
   *  'minecraft': Modrinth-backed modpacks (search/build/import). 'workshop-collection': one
   *  Steam Workshop collection ID (Source-engine `+host_workshop_collection`, e.g. Garry's Mod).
   *  'workshop-items': a list of individual Steam Workshop item IDs (e.g. Project Zomboid's
   *  MOD_WORKSHOP_IDS). Workshop downloads need no Steam API key — SteamCMD pulls public
   *  Workshop content anonymously. */
  moddingKind?: 'minecraft' | 'workshop-collection' | 'workshop-items';
  /** Which variants count as "modded" for the Minecraft-style loader picker (ignored otherwise). */
  moddedVariants?: readonly string[];
  /** Steam App ID, if this game is distributed on Steam — used to pull free official banner
   *  artwork straight from Steam's CDN (no API key needed, unlike SteamGridDB). Games not on
   *  Steam (Minecraft, its proxy) just have no banner image and fall back to a plain gradient. */
  steamAppId?: number;
  /** Protocol of this game's main 'game' port. Static per game (doesn't vary by variant) — used to
   *  decide whether the no-account bore.pub tunnel option can apply at all, since bore only
   *  forwards TCP. UDP-game-port titles (most of them) only get the playit.gg option. */
  gamePortProtocol: 'tcp' | 'udp';
  /** Set for games whose image downloads the whole game from Steam on every first boot (the
   *  SteamCMD-backed images — Garry's Mod is 6.87GB of it, measured live). Names the one volume
   *  holding those big, byte-identical-for-everyone engine/content files, so Outpost can keep a
   *  single shared copy and hand it to each new server instead of re-downloading it every time.
   *  Only ever name a volume that holds pure game content: anything carrying per-server state
   *  (world saves, configs, RCON secrets) would leak between servers if it were shared. Games with
   *  the content baked into the image itself (Terraria, Factorio) have nothing to cache and leave
   *  this unset. */
  contentCache?: {
    /** Which VolumeSpec.hostSubdir holds the cacheable content. */
    subdir: string;
    /** Rough download size, for the UI to set expectations before a prewarm. */
    approxSizeLabel: string;
    /** Top-level entries inside `subdir` that are per-server state rather than shared content, and
     *  so must never be captured into (or restored from) the shared cache. 7 Days to Die is the
     *  awkward one: its image wants serverconfig.xml sitting in the same directory as the game
     *  install, so caching that directory wholesale would copy the first server's name and player
     *  cap into every server created afterwards. */
    exclude?: string[];
  };
  /** Matched against recent container logs to tell "container running" apart from "world/map
   *  actually finished loading and is accepting players" — without this a freshly-started
   *  container reads as immediately "Running!" even mid-boot. When absent, readinessService
   *  falls back to TCP-probing the RCON port (or the game port, if it's TCP) instead. */
  readyLogPattern?: RegExp;
  /** Matched against recent container logs to catch a distinct "actively installing" phase before
   *  the game process itself has even started (e.g. a modded Minecraft server's loader installer
   *  fetching a hundred-odd library jars, or Modrinth mod downloads) — surfaced as its own
   *  readiness state so a slow-but-healthy first boot doesn't just look like generic "Booting up!"
   *  with no signal that anything is actually happening. */
  installingLogPattern?: RegExp;
  /** Server options this game exposes on the Settings tab. Applied by this def's own
   *  buildContainerSpec from the `extraSettings` input, so they take effect on the next container
   *  rebuild (the Settings tab does that automatically on save). */
  settings?: GameSettingField[];
  /** RCON-backed player management. Only set for games where Outpost knows the real admin command
   *  syntax with confidence — every RCON dialect answers differently, so guessing wrong here would
   *  silently no-op (or worse) on someone's live server. Games without this just show no player
   *  count and no Players tab rather than a feature that might not actually work. */
  players?: {
    /** Lists currently-connected players. `max` is the server's live player cap when the RCON
     *  response happens to report one (Minecraft, Source engine), null when it doesn't (Factorio,
     *  Zomboid) — never guessed from a launch-arg default that could've been overridden. */
    list: {
      command: string;
      /** `map` is the currently-loaded map/level, only when the RCON response happens to report
       *  one (Source engine's `status` does). */
      parse(output: string): { players: PlayerRef[]; max: number | null; map?: string | null };
    };
    /** Returns the RCON command string to run — callers execute it as-is. */
    kick(player: PlayerRef): string;
    ban(player: PlayerRef): string;
    /** Not every RCON dialect exposes a real "kill this specific player" command. */
    kill?(player: PlayerRef): string;
    /** Banned players aren't connected, so listing/lifting bans needs its own query — omitted for
     *  games with no reliable RCON-queryable ban list. */
    banned?: { command: string; parse(output: string): PlayerRef[] };
    unban?(player: PlayerRef): string;
    /** Grants/revokes server admin — a Minecraft-specific concept (vanilla `op`/`deop`), so this is
     *  the rare admin action that's only ever set for one game rather than shared across a whole
     *  RCON dialect. Not offered where it doesn't apply. */
    op?(player: PlayerRef): string;
    deop?(player: PlayerRef): string;
  };
  /** Lets the Settings tab change the running server's map/level live over RCON instead of
   *  recreating the container — real support in games with a server-side "change map now" console
   *  command (Source engine's `changelevel`). Current map comes from the same `players.list`
   *  response so switching maps costs no extra RCON round trip. */
  mapControl?: {
    /** value -> display label, e.g. "cp_badlands" -> "Control Point — Badlands". */
    options: Record<string, string>;
    changeCommand(map: string): string;
  };
  buildContainerSpec(input: {
    /** The user's friendly server name — used as the in-game hostname/server-browser name where
     *  the underlying game supports setting one. */
    name: string;
    containerName: string;
    dataPath: string;
    memoryMb: number;
    variant: string;
    version: string;
    /** Every server gets one, whether or not the game actually has RCON — defs that don't
     *  support RCON just ignore it. */
    rconPassword: string;
    /** Modrinth mods to install, pinned to an exact project+version pair. Minecraft-only. */
    modrinthMods?: { projectId: string; versionId: string }[];
    /** Steam Workshop collection ID. Only used by moddingKind: 'workshop-collection' games. */
    workshopCollectionId?: string;
    /** Steam Workshop item IDs. Only used by moddingKind: 'workshop-items' games. */
    workshopItemIds?: string[];
    /** The mod's own internal ID (from its mod.info/modinfo.txt), same order as
     *  workshopItemIds — Project Zomboid needs both to actually enable a downloaded mod. */
    modIds?: string[];
    /** Message of the day, where the game supports one. Optional everywhere. */
    motd?: string;
    /** Extra per-game behavior settings a def opts into supporting (Minecraft: itzg env-var-style
     *  keys like ALLOW_FLIGHT, PVP, DIFFICULTY straight through) — see GameServer.extraSettings.
     *  Defs that don't support any of this just ignore the field. */
    extraSettings?: Record<string, string>;
  }): CreateContainerSpec;
}
