import type { GameDefinition } from './types.js';
import { parseSourceStatus } from './sourceEngine.js';

// ghcr.io/ich777/steamcmd:garrysmod — a Debian Bullseye-based SteamCMD wrapper, part of the
// actively-maintained ich777 Unraid game-server image family. (zennoe/gmod-vanilla, tried first,
// has a base OS too old to run the current Garry's Mod binary at all — GLIBC_2.29 not found —
// so it's not usable regardless of config.) GMod is free to run without owning the game or a
// Steam account (SteamCMD anonymous login, app id 4020).
const IMAGE = 'ghcr.io/ich777/steamcmd:garrysmod';

export const gmodDefinition: GameDefinition = {
  id: 'gmod',
  displayName: "Garry's Mod",
  variants: ['sandbox', 'ttt', 'prophunt'],
  versionLabel: null,
  moddable: true,
  moddingKind: 'workshop-collection',
  steamAppId: 4000,
  gamePortProtocol: 'udp',
  // /serverdata/serverfiles is the SteamCMD install target — pure game content, no per-server
  // state (that lives in the separate steamcmd volume and in the launch args). Measured at 6.87GB
  // downloaded from scratch on every new server before this cache existed.
  contentCache: { subdir: 'server', approxSizeLabel: '~6.9 GB' },
  players: {
    list: {
      command: 'status',
      parse: parseSourceStatus,
    },
    kick: (player) => `kick "${player.name}"`,
    // banid's first arg is minutes; 0 means permanent. Takes effect immediately, no separate
    // "apply" step needed.
    ban: (player) => `banid 0 ${player.id} kick`,
    unban: (player) => `removeid ${player.id}`,
  },

  settings: [
    {
      key: 'maxplayers',
      label: 'Max players',
      info: 'Garry\'s Mod handles large servers well, but every extra slot costs memory — 16 is a comfortable default for a friends server, 32+ suits a public one with the memory to match.',
      type: 'number',
      default: '16',
      min: 1,
      max: 128,
      group: 'Capacity',
    },
    {
      key: 'map',
      label: 'Starting map',
      info: 'The map the server loads on boot. gm_flatgrass and gm_construct are the two sandbox maps that ship with every Garry\'s Mod server; anything else has to come from a Workshop collection.',
      type: 'select',
      default: 'gm_flatgrass',
      options: [
        { value: 'gm_flatgrass', label: 'Flatgrass' },
        { value: 'gm_construct', label: 'Construct' },
      ],
      group: 'Gameplay',
    },
    {
      key: 'sv_password',
      label: 'Join password',
      info: 'Players are asked for this when connecting. Leave blank for an open server.',
      type: 'text',
      default: '',
      group: 'Access',
    },
    {
      key: 'sv_cheats',
      label: 'Allow cheat commands',
      info: 'Off by default. On, players can use console commands like noclip and god — handy for a private build server, a bad idea on a public one.',
      type: 'toggle',
      default: '0',
      onValue: '1',
      offValue: '0',
      group: 'Gameplay',
    },
    {
      key: 'sv_alltalk',
      label: 'Global voice chat',
      info: 'On means everyone hears everyone. Off restricts voice to teammates, which only matters in gamemodes that actually have teams (TTT, Prop Hunt).',
      type: 'toggle',
      default: '1',
      onValue: '1',
      offValue: '0',
      group: 'Gameplay',
    },
    {
      key: 'sv_gravity',
      label: 'Gravity',
      info: 'Source engine default is 600. Lower values make everything floaty (moon gravity around 200); higher makes movement heavy.',
      type: 'number',
      default: '600',
      min: 0,
      max: 2000,
      group: 'Gameplay',
    },
  ],

  buildContainerSpec({ containerName, dataPath, memoryMb, variant, rconPassword, workshopCollectionId, extraSettings }) {
    const gamemode = variant === 'ttt' ? 'terrortown' : variant === 'prophunt' ? 'prop_hunt' : 'sandbox';
    const setting = (key: string, fallback: string) => extraSettings?.[key] ?? fallback;
    // GAME_PARAMS gets substituted into a bash command unquoted (`${GAME_PARAMS}` in ich777's
    // start-server.sh), so any value containing spaces or quote characters — like a user-chosen
    // server name — would be word-split into broken args. Sticking to space-free convars here.
    // +host_workshop_collection downloads every addon in a public Steam Workshop collection at
    // startup — a real srcds feature, no Steam API key needed since SteamCMD pulls public
    // Workshop content anonymously.
    const params = [
      '-secure',
      `+gamemode ${gamemode}`,
      `+map ${setting('map', 'gm_flatgrass')}`,
      `+maxplayers ${setting('maxplayers', '16')}`,
      `+sv_cheats ${setting('sv_cheats', '0')}`,
      `+sv_alltalk ${setting('sv_alltalk', '1')}`,
      `+sv_gravity ${setting('sv_gravity', '600')}`,
      `+rcon_password ${rconPassword}`,
    ];
    // Same word-splitting caveat as above: only send a join password when there is one, and only
    // if it has no whitespace to be split on.
    const joinPassword = setting('sv_password', '').trim();
    if (joinPassword && !/\s/.test(joinPassword)) params.push(`+sv_password ${joinPassword}`);
    if (workshopCollectionId) params.push(`+host_workshop_collection ${workshopCollectionId}`);

    return {
      image: IMAGE,
      containerName,
      env: ['GAME_ID=4020', 'GAME_NAME=garrysmod', 'GAME_PORT=27015', `GAME_PARAMS=${params.join(' ')}`],
      ports: [
        { containerPort: 27015, protocol: 'udp', purpose: 'game' },
        { containerPort: 27015, protocol: 'tcp', purpose: 'rcon' },
      ],
      volumes: [
        { hostSubdir: 'steamcmd', containerPath: '/serverdata/steamcmd' },
        { hostSubdir: 'server', containerPath: '/serverdata/serverfiles' },
      ],
      memoryMb,
      dataPath,
    };
  },
};
