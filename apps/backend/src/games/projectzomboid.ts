import type { GameDefinition } from './types.js';

// renegademaster/zomboid-dedicated-server: free dedicated server depot (SteamCMD app id 380870,
// no purchase or Steam account required). Confirmed RCON support with a real password/port env.
const IMAGE = 'docker.io/renegademaster/zomboid-dedicated-server';

export const projectZomboidDefinition: GameDefinition = {
  id: 'zomboid',
  displayName: 'Project Zomboid',
  variants: ['default'],
  versionLabel: null,
  moddable: true,
  moddingKind: 'workshop-items',
  steamAppId: 108600,
  gamePortProtocol: 'udp',
  // Project Zomboid prints this (all-caps, no punctuation) once the world/save is fully loaded
  // and the server is accepting connections.
  readyLogPattern: /SERVER STARTED/,
  // ZomboidDedicatedServer holds the SteamCMD-installed game itself; every bit of per-server state
  // (saves, settings, downloaded Workshop mods) lives under the separate /home/steam/Zomboid volume.
  contentCache: { subdir: 'server', approxSizeLabel: '~3 GB' },
  settings: [
    {
      key: 'MAX_PLAYERS',
      label: 'Max players',
      info: "Project Zomboid streams a lot of world state per player, so this is heavier than it looks — 16 is a sensible ceiling unless you've given the server plenty of memory.",
      type: 'number',
      default: '16',
      min: 1,
      max: 64,
      group: 'Capacity',
    },
    {
      key: 'SERVER_PASSWORD',
      label: 'Join password',
      info: 'Players are asked for this when connecting. Leave blank for an open server.',
      type: 'text',
      default: '',
      group: 'Access',
    },
    {
      key: 'PUBLIC_SERVER',
      label: 'List publicly',
      info: "Off by default. On, the server shows up in Project Zomboid's in-game public server browser.",
      type: 'toggle',
      default: 'false',
      onValue: 'true',
      offValue: 'false',
      group: 'Access',
    },
    {
      key: 'PAUSE_ON_EMPTY',
      label: 'Pause when empty',
      info: 'On by default, and worth keeping on — with nobody connected the world stops ticking, so time and zombie spawns stay frozen instead of the apocalypse advancing while everyone is offline.',
      type: 'toggle',
      default: 'true',
      onValue: 'true',
      offValue: 'false',
      group: 'Gameplay',
    },
    {
      key: 'PVP',
      label: 'Player vs. player damage',
      info: 'Off by default. On, players can injure each other directly — zombies and environmental damage apply either way.',
      type: 'toggle',
      default: 'false',
      onValue: 'true',
      offValue: 'false',
      group: 'Gameplay',
    },
  ],
  players: {
    list: {
      command: 'players',
      // "Players connected (2):\n-Alice\n-Bob" — no player cap reported by this command.
      parse: (output) => ({
        players: [...output.matchAll(/^-(.+)$/gm)].map((m) => ({ name: m[1]!.trim(), id: m[1]!.trim() })),
        max: null,
      }),
    },
    kick: (player) => `kickuser ${player.name}`,
    ban: (player) => `banuser ${player.name}`,
    unban: (player) => `unbanuser ${player.name}`,
  },

  buildContainerSpec({ name, containerName, dataPath, memoryMb, rconPassword, workshopItemIds, modIds, extraSettings }) {
    const setting = (key: string, fallback: string) => extraSettings?.[key] ?? fallback;
    const env = [
      `SERVER_NAME=${name.replace(/[^a-zA-Z0-9]/g, '') || 'OutpostServer'}`,
      `RCON_PASSWORD=${rconPassword}`,
      'RCON_PORT=27015',
      'DEFAULT_PORT=16261',
      'UDP_PORT=16262',
      `MAX_PLAYERS=${setting('MAX_PLAYERS', '16')}`,
      `PUBLIC_SERVER=${setting('PUBLIC_SERVER', 'false')}`,
      `PAUSE_ON_EMPTY=${setting('PAUSE_ON_EMPTY', 'true')}`,
      `PVP=${setting('PVP', 'false')}`,
    ];
    const joinPassword = setting('SERVER_PASSWORD', '');
    if (joinPassword) env.push(`SERVER_PASSWORD=${joinPassword}`);
    // Both lists have to line up 1:1 and in the same order — that's how the underlying
    // WorkshopItems/Mods .ini properties correlate a downloaded Workshop item with the mod
    // folder(s) it actually contains.
    if (workshopItemIds && workshopItemIds.length > 0) env.push(`MOD_WORKSHOP_IDS=${workshopItemIds.join(';')}`);
    if (modIds && modIds.length > 0) env.push(`MOD_NAMES=${modIds.join(';')}`);

    return {
      image: IMAGE,
      containerName,
      env,
      ports: [
        { containerPort: 16261, protocol: 'udp', purpose: 'game' },
        { containerPort: 16262, protocol: 'udp', purpose: 'extra' },
        { containerPort: 27015, protocol: 'tcp', purpose: 'rcon' },
      ],
      volumes: [
        { hostSubdir: 'server', containerPath: '/home/steam/ZomboidDedicatedServer' },
        { hostSubdir: 'config', containerPath: '/home/steam/Zomboid' },
      ],
      memoryMb,
      dataPath,
    };
  },
};
