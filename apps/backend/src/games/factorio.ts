import fs from 'node:fs/promises';
import path from 'node:path';
import type { GameDefinition } from './types.js';

// factoriotools/factorio: https://github.com/factoriotools/factorio-docker
// Official-community-maintained image; handles the headless server binary, saves, and RCON.
const IMAGE = 'factoriotools/factorio:stable';

export const factorioDefinition: GameDefinition = {
  id: 'factorio',
  displayName: 'Factorio',
  variants: ['default'],
  versionLabel: null,
  moddable: false,
  steamAppId: 427520,
  gamePortProtocol: 'udp',
  // Factorio logs this exact transition once the save has finished loading and the game is
  // joinable, well after the process itself starts.
  readyLogPattern: /changing state from\(CreatingGame\) to\(InGame\)/,
  players: {
    list: {
      command: '/players online',
      // Matching "<name> (online)" per line is resilient to the header's exact wording changing
      // across Factorio versions.
      parse: (output) => ({
        players: [...output.matchAll(/^\s*(\S+)\s+\(online\)/gm)].map((m) => ({
          name: m[1]!,
          id: m[1]!,
        })),
        max: null,
      }),
    },
    kick: (player) => `/kick ${player.name}`,
    ban: (player) => `/ban ${player.name}`,
    banned: {
      command: '/banlist',
      parse: (output) =>
        output
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l && !/^banned players/i.test(l))
          .map((name) => ({ name, id: name })),
    },
    unban: (player) => `/unban ${player.name}`,
  },

  // Written into config/server-settings.json by preCreate below.
  settings: [
    {
      key: 'max_players',
      label: 'Max players',
      info: 'Factorio scales well — the practical limit is usually your upload bandwidth, not the server. 0 means no limit.',
      type: 'number',
      default: '0',
      min: 0,
      max: 250,
      group: 'Capacity',
    },
    {
      key: 'game_password',
      label: 'Join password',
      info: 'Players are asked for this when connecting. Leave blank for an open server.',
      type: 'text',
      default: '',
      group: 'Access',
    },
    {
      key: 'require_user_verification',
      label: 'Require Factorio accounts',
      info: "On by default, verifies each player against Factorio's auth servers. Turn off only for a LAN game — with it off, anyone can join under any name.",
      type: 'toggle',
      default: 'true',
      onValue: 'true',
      offValue: 'false',
      group: 'Access',
    },
    {
      key: 'auto_pause',
      label: 'Pause when empty',
      info: 'On by default — with nobody connected the factory stops rather than running (and backing up) unattended.',
      type: 'toggle',
      default: 'true',
      onValue: 'true',
      offValue: 'false',
      group: 'Gameplay',
    },
    {
      key: 'allow_commands',
      label: 'Console commands',
      info: "Admins-only is the default. Note that in Factorio, running most commands permanently disables achievements for that save — 'true' lets any player trigger that.",
      type: 'select',
      default: 'admins-only',
      options: [
        { value: 'true', label: 'Anyone' },
        { value: 'admins-only', label: 'Admins only' },
        { value: 'false', label: 'Nobody' },
      ],
      group: 'Gameplay',
    },
    {
      key: 'autosave_interval',
      label: 'Autosave interval (minutes)',
      info: 'How often the server writes a save. Frequent autosaves cause a brief stutter on a big factory, so raise this if you notice regular hitching.',
      type: 'number',
      default: '10',
      min: 1,
      max: 120,
      group: 'Gameplay',
    },
  ],

  buildContainerSpec({ name, containerName, dataPath, memoryMb, rconPassword, extraSettings }) {
    const setting = (key: string, fallback: string) => extraSettings?.[key] ?? fallback;
    return {
      image: IMAGE,
      containerName,
      env: ['GENERATE_NEW_SAVE=true', 'SAVE_NAME=world'],
      ports: [
        { containerPort: 34197, protocol: 'udp', purpose: 'game' },
        { containerPort: 27015, protocol: 'tcp', purpose: 'rcon' },
      ],
      volumes: [{ hostSubdir: '', containerPath: '/factorio' }],
      memoryMb,
      dataPath,
      // The entrypoint only auto-generates a random RCON password when config/rconpw doesn't
      // already exist.
      async preCreate(hostPaths) {
        const configDir = path.join(hostPaths['']!, 'config');
        await fs.mkdir(configDir, { recursive: true });
        await fs.writeFile(path.join(configDir, 'rconpw'), rconPassword, 'utf8');

        // Factorio reads every server option from this one file.
        await fs.writeFile(
          path.join(configDir, 'server-settings.json'),
          JSON.stringify(
            {
              name,
              description: 'Hosted with Outpost',
              max_players: Number(setting('max_players', '0')),
              visibility: { public: false, lan: true },
              game_password: setting('game_password', ''),
              require_user_verification: setting('require_user_verification', 'true') === 'true',
              auto_pause: setting('auto_pause', 'true') === 'true',
              allow_commands: setting('allow_commands', 'admins-only'),
              autosave_interval: Number(setting('autosave_interval', '10')),
              autosave_slots: 5,
            },
            null,
            2,
          ),
          'utf8',
        );
      },
    };
  },
};
