import type { GameDefinition } from './types.js';

// itzg/docker-minecraft-server: https://github.com/itzg/docker-minecraft-server
// Battle-tested image that already handles EULA, vanilla/Paper/Fabric/Forge/NeoForge/Quilt
// startup, JVM flags, and installing a list of Modrinth project versions via MODRINTH_PROJECTS.
// We deliberately don't reimplement any of that ourselves.
//
// The image does NOT auto-detect which Java runtime a given Minecraft version needs — `:latest`
// always bundles the newest Java the image ships (Java 25 as of this writing). Point an old
// modded server (e.g. Forge 1.19.2, which needs Java 17) at `:latest` and Mixin/ASM can't even
// parse the JDK's own class files ("Unsupported class file major version"), so it crash-loops on
// every boot forever instead of actually being slow. We have to pick the matching `:javaNN` tag
// ourselves, based on Mojang's published minimum Java version per Minecraft release:
// https://minecraft.wiki/w/Tutorial:Update_Java
function javaImageTag(version: string, variant: string): string {
  const m = version.match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return 'java21'; // "LATEST"/"SNAPSHOT"/unparseable — assume a current version
  const major = Number(m[1]);
  // Mojang dropped the "1." version prefix at some point (e.g. "26.2") — every one of those releases
  // is newer than anything the tiered checks below were written for, so treating a non-1.x major as
  // if it were an ancient "1.<major>.<minor>" release (this bug: "26.2" parsed as major=1 minor=26,
  // landing on java8) is exactly backwards. Confirmed directly against a live "26.2" boot failure
  // ("class file version 69.0" — that's Java 25) that java21 alone isn't new enough either, so
  // anything outside the legacy 1.x scheme gets the newest tag itzg's image ships.
  if (major !== 1) return 'java25';
  const minor = Number(m[2]);
  const patch = Number(m[3] ?? '0');
  // Forge/NeoForge specifically refuse to run below 1.18 on anything newer than Java 8, even
  // though vanilla 1.17 itself only requires Java 16.
  if (minor < 17 || ((variant === 'forge' || variant === 'neoforge') && minor < 18)) return 'java8';
  if (minor === 17) return 'java16';
  if (minor < 20 || (minor === 20 && patch < 5)) return 'java17';
  return 'java21';
}

const VARIANT_TO_TYPE: Record<string, string> = {
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
  variants: ['vanilla', 'paper', 'fabric', 'forge', 'neoforge', 'quilt'],
  versionLabel: 'Minecraft version',
  versionPlaceholder: '1.21.1 (or LATEST)',
  moddable: true,
  moddingKind: 'minecraft',
  moddedVariants: ['fabric', 'forge', 'neoforge', 'quilt'],
  gamePortProtocol: 'tcp',
  // The line every Minecraft server (vanilla/Paper/Fabric/Forge alike) prints once the world has
  // finished loading and it's actually accepting players, e.g. `Done (12.345s)! For help, type "help"`.
  readyLogPattern: /Done \([\d.]+s\)!/,
  // itzg's image logs one of these while a modded server's loader installer (Forge/NeoForge/
  // Fabric/Quilt) is still fetching its library jars, or while requested Modrinth mods are still
  // downloading — both can take several minutes on a first boot with nothing cached yet.
  installingLogPattern: /\binstaller\b|Downloading (mod|MODRINTH)/i,
  // Each key is an itzg env var that maps straight to the matching server.properties line
  // (MAX_PLAYERS -> max-players, and so on) — see buildContainerSpec, which passes these through
  // verbatim.
  settings: [
    {
      key: 'MAX_PLAYERS',
      label: 'Max players',
      info: 'How many people can be connected at once. Raising this costs memory — roughly 100-150MB per additional active player on a modded server, so check the memory slider too if you go much past 20.',
      type: 'number',
      default: '20',
      min: 1,
      max: 200,
      group: 'Capacity',
    },
    {
      key: 'VIEW_DISTANCE',
      label: 'View distance (chunks)',
      info: "How far players can see. This is the single biggest lever on server CPU and memory — dropping from 10 to 6 often fixes lag on a busy or modded server, and most players won't notice.",
      type: 'number',
      default: '10',
      min: 3,
      max: 32,
      group: 'Capacity',
    },
    {
      key: 'SIMULATION_DISTANCE',
      label: 'Simulation distance (chunks)',
      info: 'How far from each player the world actually ticks — mobs move, crops grow, redstone runs. Lowering this is gentler on gameplay than lowering view distance, since distant terrain still renders, it just sits frozen.',
      type: 'number',
      default: '10',
      min: 3,
      max: 32,
      group: 'Capacity',
    },
    {
      key: 'ALLOW_FLIGHT',
      label: 'Allow flying',
      info: 'Off by default, vanilla Minecraft kicks any player whose client reports flying — even from a legitimate mod (a wing/cape item, a double-jump mod, elytra-adjacent mods). If modded players keep getting kicked for "flying", this is almost always the fix.',
      type: 'toggle',
      default: 'false',
      onValue: 'true',
      offValue: 'false',
      group: 'Gameplay',
    },
    {
      key: 'ONLINE_MODE',
      label: 'Require Microsoft accounts',
      info: 'On by default, verifies every player against Mojang/Microsoft servers. Turn off only for a LAN-only/offline ("cracked") setup — with it off, anyone can connect by typing any username, with no ownership check at all.',
      type: 'toggle',
      default: 'true',
      onValue: 'true',
      offValue: 'false',
      group: 'Access',
    },
    {
      key: 'PVP',
      label: 'Player vs. player damage',
      info: 'On by default. Turn off to stop players from being able to hurt each other directly — mobs and environmental damage still apply.',
      type: 'toggle',
      default: 'true',
      onValue: 'true',
      offValue: 'false',
      group: 'Gameplay',
    },
    {
      key: 'SPAWN_PROTECTION',
      label: 'Protect spawn from building',
      info: "On by default (a 16-block radius around spawn where only server operators can break/place blocks) — a common gotcha where new players can't figure out why they can't build near spawn. Turning this off lets everyone build right away.",
      type: 'toggle',
      default: '16',
      onValue: '0',
      offValue: '16',
      group: 'Access',
    },
    {
      key: 'SPAWN_MONSTERS',
      label: 'Hostile mobs spawn',
      info: 'On by default. Turn off for a peaceful build/creative-focused server without changing the difficulty (which also affects hunger and other mechanics).',
      type: 'toggle',
      default: 'true',
      onValue: 'true',
      offValue: 'false',
      group: 'Gameplay',
    },
    {
      key: 'ENABLE_COMMAND_BLOCK',
      label: 'Command blocks',
      info: 'Off by default. Needed for some adventure maps and redstone contraptions that use command blocks — leave off unless a specific map/build calls for it, since command blocks can run any server command.',
      type: 'toggle',
      default: 'false',
      onValue: 'true',
      offValue: 'false',
      group: 'Gameplay',
    },
    {
      key: 'ALLOW_NETHER',
      label: 'Nether enabled',
      info: 'On by default. Turning it off blocks portal travel entirely — occasionally wanted for a skyblock or overworld-only survival server.',
      type: 'toggle',
      default: 'true',
      onValue: 'true',
      offValue: 'false',
      group: 'Gameplay',
    },
    {
      key: 'ENABLE_WHITELIST',
      label: 'Whitelist only',
      info: "On means nobody can join unless they've been added to the whitelist — the standard way to keep a private server private. Add players from the Players tab once this is on.",
      type: 'toggle',
      default: 'false',
      onValue: 'true',
      offValue: 'false',
      group: 'Access',
    },
    {
      key: 'HARDCORE',
      label: 'Hardcore mode',
      info: 'Off by default. On, difficulty is locked to Hard and a player who dies is permanently banned from the world (switched to spectator). Only affects players who die after the change.',
      type: 'toggle',
      default: 'false',
      onValue: 'true',
      offValue: 'false',
      group: 'Gameplay',
    },
    {
      key: 'LEVEL_SEED',
      label: 'World seed',
      info: 'Leave blank for a random world. Entering a seed only matters when the world is first generated — an existing world keeps its own seed no matter what you put here.',
      type: 'text',
      default: '',
      group: 'World generation',
      newWorldOnly: true,
    },
  ],
  players: {
    list: {
      command: 'list',
      parse: (output) => {
        // "There are 2 of a max of 20 players online: Alice, Bob" (or no trailing ": ..." at 0).
        const header = output.match(/There are (\d+) of a max of (\d+) players online/i);
        const max = header ? Number(header[2]) : null;
        const names = output.match(/players online:\s*(.+)/i);
        if (!names?.[1]) return { players: [], max };
        const players = names[1]
          .split(',')
          .map((name) => name.trim())
          .filter(Boolean)
          .map((name) => ({ name, id: name }));
        return { players, max };
      },
    },
    kick: (player) => `kick ${player.name}`,
    ban: (player) => `ban ${player.name}`,
    kill: (player) => `kill ${player.name}`,
    banned: {
      command: 'banlist',
      // RCON's banlist response has no separator between entries at all — each ban reason runs
      // straight into the next player's name with no space (confirmed live: "...banned by an
      // operator.Notch was banned by..."). A plain \S+ would grab "operator.Notch" as one name.
      // Minecraft usernames are strictly alphanumeric/underscore, so matching that exact charset
      // instead of \S+ correctly stops at the real name boundary regardless of what's next to it.
      parse: (output) => [...output.matchAll(/([A-Za-z0-9_]{1,16}) was banned by/g)].map((m) => ({ name: m[1]!, id: m[1]! })),
    },
    unban: (player) => `pardon ${player.name}`,
    op: (player) => `op ${player.name}`,
    deop: (player) => `deop ${player.name}`,
  },

  buildContainerSpec({ containerName, dataPath, memoryMb, variant, version, rconPassword, modrinthMods, motd, extraSettings }) {
    const type = VARIANT_TO_TYPE[variant];
    if (!type) {
      throw new Error(`Unknown Minecraft variant: ${variant}`);
    }

    const env = [
      'EULA=TRUE',
      `TYPE=${type}`,
      `VERSION=${version}`,
      `MEMORY=${memoryMb}M`,
      'ENABLE_RCON=true',
      `RCON_PASSWORD=${rconPassword}`,
      // We resolve dependency versions ourselves (see modrinth/dependencies.ts), so tell the
      // image not to try to resolve them again on its own.
      'MODRINTH_DOWNLOAD_DEPENDENCIES=none',
      // Modern NeoForge/Forge (21.x+) default to a graphical "early loading" splash window that
      // needs LWJGL/OpenGL — nonexistent in a headless server container, so it throws
      // ClassNotFoundException: org.lwjgl.Version and crash-loops forever right after a successful
      // install. This flag (NeoForge's documented headless-server fix) disables that window.
      'JVM_OPTS=-Dfml.earlyprogresswindow=false',
    ];

    if (motd) env.push(`MOTD=${motd}`);

    if (modrinthMods && modrinthMods.length > 0) {
      // itzg's image expects each entry as "<project id>:<version id>", not a bare version id.
      env.push(`MODRINTH_PROJECTS=${modrinthMods.map((m) => `${m.projectId}:${m.versionId}`).join(',')}`);
    }

    // itzg's image maps any of these straight to the matching server.properties key (ALLOW_FLIGHT
    // -> allow-flight, etc.) — see the `settings` array above for the ones Outpost exposes. Empty
    // values are dropped rather than passed as an empty env var, so a blank "world seed" field
    // means "random" instead of pinning the seed to the literal empty string.
    for (const [key, value] of Object.entries(extraSettings ?? {})) {
      if (value !== '') env.push(`${key}=${value}`);
    }

    return {
      image: `itzg/minecraft-server:${javaImageTag(version, variant)}`,
      containerName,
      env,
      ports: [
        { containerPort: 25565, protocol: 'tcp', purpose: 'game' },
        { containerPort: 25575, protocol: 'tcp', purpose: 'rcon' },
      ],
      volumes: [{ hostSubdir: '', containerPath: '/data' }],
      memoryMb,
      dataPath,
    };
  },
};
