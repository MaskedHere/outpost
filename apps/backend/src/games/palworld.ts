import type { GameDefinition, PlayerRef } from './types.js';

// thijsvanloef/palworld-server-docker: https://github.com/thijsvanloef/palworld-server-docker
// The actively-maintained community image.
const IMAGE = 'thijsvanloef/palworld-server-docker:latest';

/** Palworld's `ShowPlayers` answers with a CSV table rather than Source's `status` layout. */
function parsePalworldPlayers(output: string): { players: PlayerRef[]; max: number | null } {
  const players: PlayerRef[] = [];
  for (const line of output.split('\n')) {
    const row = line.trim();
    if (!row || /^name\s*,/i.test(row)) continue;
    const [name, , steamId] = row.split(',');
    if (!name) continue;
    // A player still loading in can have an empty Steam ID; fall back to the name so the row stays
    // visible.
    players.push({ name: name.trim(), id: (steamId ?? '').trim() || name.trim() });
  }
  return { players, max: null };
}

export const palworldDefinition: GameDefinition = {
  id: 'palworld',
  displayName: 'Palworld',
  variants: ['default'],
  versionLabel: null,
  moddable: false,
  steamAppId: 1623730,
  gamePortProtocol: 'udp',
  // Cache the SteamCMD install so new servers don't re-download it. Palworld has no separate server
  // volume, so the per-server paths are excluded instead:
  //   Pal/Saved               worlds plus generated PalWorldSettings.ini / Engine.ini
  //   backups                 the image's own backup directory
  //   Pal/Content/Paks/~mods  this server's mods (see palworldModsService)
  contentCache: {
    subdir: '',
    approxSizeLabel: '~12 GB',
    exclude: ['Pal/Saved', 'backups', 'Pal/Content/Paks/~mods'],
  },
  // No readyLogPattern: startup output is noisy and varies between releases, so readiness uses an
  // authenticated RCON probe instead (see probeRcon).
  players: {
    list: {
      command: 'ShowPlayers',
      parse: parsePalworldPlayers,
    },
    // Palworld's admin commands are keyed on Steam ID, not player name.
    kick: (player) => `KickPlayer ${player.id}`,
    ban: (player) => `BanPlayer ${player.id}`,
  },
  settings: [
    {
      key: 'PLAYERS',
      label: 'Max players',
      info: "Palworld's own ceiling is 32. The server simulates every base and pal belonging to every player, so it gets heavy well before that — 8-16 is a comfortable range unless you have memory to spare.",
      type: 'number',
      default: '16',
      min: 1,
      max: 32,
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
      key: 'COMMUNITY',
      label: 'List in community browser',
      info: "Off by default. On, the server appears in Palworld's in-game community server list — which also requires a password to be set. Turn this on if anyone is joining from an Xbox or a PS5: consoles can only reach a server through that list, they cannot type in an address the way Steam and Mac players can.",
      type: 'toggle',
      default: 'false',
      onValue: 'true',
      offValue: 'false',
      group: 'Access',
    },
    {
      key: 'CROSSPLAY_PLATFORMS',
      label: 'Allowed platforms',
      info: 'Which platforms may connect at all. All four by default, which is almost always what you want — narrowing this is for when you deliberately need a Steam-only server. Note that allowing consoles here is not enough on its own; they also need the community listing above.',
      type: 'select',
      default: '(Steam,Xbox,PS5,Mac)',
      options: [
        { value: '(Steam,Xbox,PS5,Mac)', label: 'All platforms' },
        { value: '(Steam,Mac)', label: 'PC and Mac only' },
        { value: '(Steam)', label: 'Steam only' },
      ],
      group: 'Access',
    },
    {
      key: 'DIFFICULTY',
      label: 'Difficulty',
      info: "Palworld's own preset difficulty. 'None' uses the individual rates below rather than a preset.",
      type: 'select',
      default: 'None',
      options: [
        { value: 'None', label: 'Custom (use rates below)' },
        { value: 'Casual', label: 'Casual' },
        { value: 'Normal', label: 'Normal' },
        { value: 'Hard', label: 'Hard' },
      ],
      group: 'Gameplay',
    },
    {
      key: 'DAYTIME_SPEEDRATE',
      label: 'Daytime speed',
      info: 'How fast daytime passes. 1 is normal; lower makes days longer.',
      type: 'text',
      default: '1.000000',
      group: 'Gameplay',
    },
    {
      key: 'EXP_RATE',
      label: 'Experience rate',
      info: 'Multiplier on all experience gained. 1 is normal; raise it for a faster-progressing server.',
      type: 'text',
      default: '1.000000',
      group: 'Gameplay',
    },
    {
      key: 'PAL_CAPTURE_RATE',
      label: 'Pal capture rate',
      info: 'Multiplier on how easily pals are caught. 1 is normal.',
      type: 'text',
      default: '1.000000',
      group: 'Gameplay',
    },
    {
      key: 'DEATH_PENALTY',
      label: 'On death you lose',
      info: 'What dropping on death costs. "All" is the harshest; "None" removes the penalty entirely.',
      type: 'select',
      default: 'All',
      options: [
        { value: 'None', label: 'Nothing' },
        { value: 'Item', label: 'Items only' },
        { value: 'ItemAndEquipment', label: 'Items and equipment' },
        { value: 'All', label: 'Everything, including pals' },
      ],
      group: 'Gameplay',
    },
    {
      key: 'ENABLE_PLAYER_TO_PLAYER_DAMAGE',
      label: 'Player vs. player damage',
      info: 'Off by default. On, players can injure each other directly.',
      type: 'toggle',
      default: 'false',
      onValue: 'true',
      offValue: 'false',
      group: 'Gameplay',
    },
    {
      key: 'MULTITHREADING',
      label: 'Multithreading',
      info: "On by default and worth keeping on — Palworld's server benefits noticeably from it on any machine with more than a couple of cores.",
      type: 'toggle',
      default: 'true',
      onValue: 'true',
      offValue: 'false',
      group: 'Performance',
    },
    {
      key: 'UPDATE_ON_BOOT',
      label: 'Update on start',
      info: 'On by default. Checks for a newer Palworld server build each time the container starts. Palworld updates often and clients refuse to connect to an out-of-date server, so turning this off usually means being unable to join after a patch.',
      type: 'toggle',
      default: 'true',
      onValue: 'true',
      offValue: 'false',
      group: 'Performance',
    },
  ],

  buildContainerSpec({ name, containerName, dataPath, memoryMb, rconPassword, extraSettings }) {
    const setting = (key: string, fallback: string) => extraSettings?.[key] ?? fallback;

    const env = [
      // The image runs the server as a non-root user and chowns its data directory to this uid/gid.
      'PUID=1000',
      'PGID=1000',
      'PORT=8211',
      'RCON_ENABLED=true',
      'RCON_PORT=25575',
      // Palworld has no separate console password: RCON's admin password *is* the server's admin
      // password, so this one value covers both.
      `ADMIN_PASSWORD=${rconPassword}`,
      `SERVER_NAME=${name.replace(/[^\w .-]/g, '') || 'Outpost Server'}`,
      `PLAYERS=${setting('PLAYERS', '16')}`,
      `MULTITHREADING=${setting('MULTITHREADING', 'true')}`,
      `UPDATE_ON_BOOT=${setting('UPDATE_ON_BOOT', 'true')}`,
      `COMMUNITY=${setting('COMMUNITY', 'false')}`,
      `CROSSPLAY_PLATFORMS=${setting('CROSSPLAY_PLATFORMS', '(Steam,Xbox,PS5,Mac)')}`,
      `DIFFICULTY=${setting('DIFFICULTY', 'None')}`,
      `DAYTIME_SPEEDRATE=${setting('DAYTIME_SPEEDRATE', '1.000000')}`,
      `EXP_RATE=${setting('EXP_RATE', '1.000000')}`,
      `PAL_CAPTURE_RATE=${setting('PAL_CAPTURE_RATE', '1.000000')}`,
      `DEATH_PENALTY=${setting('DEATH_PENALTY', 'All')}`,
      `ENABLE_PLAYER_TO_PLAYER_DAMAGE=${setting('ENABLE_PLAYER_TO_PLAYER_DAMAGE', 'false')}`,
    ];

    // Palworld refuses to list in the community browser without a password, and an empty
    // SERVER_PASSWORD env var is not the same as omitting it.
    const joinPassword = setting('SERVER_PASSWORD', '').trim();
    if (joinPassword) env.push(`SERVER_PASSWORD=${joinPassword}`);

    return {
      image: IMAGE,
      containerName,
      env,
      ports: [
        { containerPort: 8211, protocol: 'udp', purpose: 'game' },
        { containerPort: 25575, protocol: 'tcp', purpose: 'rcon' },
      ],
      volumes: [{ hostSubdir: '', containerPath: '/palworld' }],
      memoryMb,
      dataPath,
    };
  },
};
