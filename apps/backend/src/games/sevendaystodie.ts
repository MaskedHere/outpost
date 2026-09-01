import fs from 'node:fs/promises';
import path from 'node:path';
import type { GameDefinition } from './types.js';

// ghcr.io/ich777/steamcmd:7dtd — part of the actively-maintained ich777 Unraid game-server image
// family (also used for Garry's Mod below, after renegademaster/7_days_to_die-dedicated-server
// turned out to be a single 2022 image tag with no `latest`, unlikely to still work against the
// current game version). Free dedicated server depot (SteamCMD app id 294420, no purchase or
// Steam account required). No confirmed RCON/telnet support here, so it's logs-only — still real
// value (status, start/stop, backups, files).
const IMAGE = 'ghcr.io/ich777/steamcmd:7dtd';

export const sevenDaysToDieDefinition: GameDefinition = {
  id: '7dtd',
  displayName: '7 Days to Die',
  variants: ['default'],
  versionLabel: null,
  moddable: false,
  steamAppId: 251570,
  // The TCP port here is really the telnet/admin control channel — actual player traffic goes
  // over the UDP ports alongside it, so this doesn't qualify for the TCP-only bore.pub tunnel.
  gamePortProtocol: 'udp',
  // /serverdata/serverfiles is the SteamCMD install target, but this image also wants
  // serverconfig.xml living right alongside the game files (written by preCreate below) — that one
  // file is per-server and is kept out of the shared cache.
  contentCache: { subdir: 'server', approxSizeLabel: '~14 GB', exclude: ['serverconfig.xml'] },
  // Each key is a real 7 Days to Die serverconfig.xml property name, written verbatim into the
  // generated file by preCreate below.
  settings: [
    {
      key: 'ServerMaxPlayerCount',
      label: 'Max players',
      info: '7 Days to Die is one of the heavier games here — each player streams their own chunk of a fully destructible world, so 8 is a realistic default and going much past 16 needs serious memory.',
      type: 'number',
      default: '8',
      min: 1,
      max: 64,
      group: 'Capacity',
    },
    {
      key: 'ServerPassword',
      label: 'Join password',
      info: 'Players are asked for this when connecting. Leave blank for an open server.',
      type: 'text',
      default: '',
      group: 'Access',
    },
    {
      key: 'ServerVisibility',
      label: 'Server visibility',
      info: 'Public lists the server in the in-game browser. Friends-only limits it to your Steam friends. Not listed means players must connect by address.',
      type: 'select',
      default: '0',
      options: [
        { value: '2', label: 'Public' },
        { value: '1', label: 'Friends only' },
        { value: '0', label: 'Not listed' },
      ],
      group: 'Access',
    },
    {
      key: 'GameDifficulty',
      label: 'Difficulty',
      info: 'Scales how much damage zombies deal and take. 1 (Scavenger) is the gentlest, 5 (Insane) the harshest; 2 is the game\'s own default.',
      type: 'select',
      default: '2',
      options: [
        { value: '0', label: 'Scavenger (easiest)' },
        { value: '1', label: 'Adventurer' },
        { value: '2', label: 'Nomad (default)' },
        { value: '3', label: 'Warrior' },
        { value: '4', label: 'Survivalist' },
        { value: '5', label: 'Insane' },
      ],
      group: 'Gameplay',
    },
    {
      key: 'DayLightLength',
      label: 'Daylight hours per day',
      info: 'How many of the 24 in-game hours are daytime. Lower means longer, more dangerous nights — 18 is the default.',
      type: 'number',
      default: '18',
      min: 1,
      max: 23,
      group: 'Gameplay',
    },
    {
      key: 'ZombiesRun',
      label: 'Zombie speed',
      info: "Controls how zombies move. 'Default' uses the per-difficulty behaviour (walk by day, run at night); the others force one speed at all times.",
      type: 'select',
      default: '0',
      options: [
        { value: '0', label: 'Default (walk by day, run at night)' },
        { value: '1', label: 'Always walk' },
        { value: '2', label: 'Always run' },
        { value: '3', label: 'Never run' },
      ],
      group: 'Gameplay',
    },
    {
      key: 'DropOnDeath',
      label: 'What you drop on death',
      info: 'Everything is the default and the harshest of the common choices. Toolbelt-only or backpack-only soften the loss; Nothing removes the death penalty entirely.',
      type: 'select',
      default: '1',
      options: [
        { value: '0', label: 'Nothing' },
        { value: '1', label: 'Everything' },
        { value: '2', label: 'Toolbelt only' },
        { value: '3', label: 'Backpack only' },
        { value: '4', label: 'Delete everything' },
      ],
      group: 'Gameplay',
    },
    {
      key: 'BuildCreate',
      label: 'Creative mode',
      info: 'Off by default. On, players get unlimited resources and instant building — useful for setting up a base or map before opening the server up.',
      type: 'toggle',
      default: 'false',
      onValue: 'true',
      offValue: 'false',
      group: 'Gameplay',
    },
  ],

  buildContainerSpec({ name, containerName, dataPath, memoryMb, extraSettings }) {
    const setting = (key: string, fallback: string) => extraSettings?.[key] ?? fallback;
    return {
      image: IMAGE,
      containerName,
      env: ['GAME_ID=294420', 'SERVERCONFIG=serverconfig.xml', 'GAME_PARAMS=-logfile 7DaysToDie_Data/output_log.txt $@'],
      ports: [
        { containerPort: 26900, protocol: 'tcp', purpose: 'game' },
        { containerPort: 26900, protocol: 'udp', purpose: 'extra' },
        { containerPort: 26901, protocol: 'udp', purpose: 'extra' },
        { containerPort: 26902, protocol: 'udp', purpose: 'extra' },
      ],
      volumes: [
        { hostSubdir: 'steamcmd', containerPath: '/serverdata/steamcmd' },
        { hostSubdir: 'server', containerPath: '/serverdata/serverfiles' },
      ],
      memoryMb,
      dataPath,
      // Rewritten on every container create rather than only when missing, so changing a setting
      // on the Settings tab actually takes effect — the container rebuild is what applies it. The
      // world save lives elsewhere in this directory and is untouched by this.
      async preCreate(hostPaths) {
        const xmlSafe = (value: string) => value.replace(/[<>&"']/g, '');
        const properties: Record<string, string> = {
          ServerName: xmlSafe(name),
          ServerPort: '26900',
          ServerMaxPlayerCount: setting('ServerMaxPlayerCount', '8'),
          ServerPassword: xmlSafe(setting('ServerPassword', '')),
          ServerVisibility: setting('ServerVisibility', '0'),
          GameDifficulty: setting('GameDifficulty', '2'),
          DayLightLength: setting('DayLightLength', '18'),
          ZombiesRun: setting('ZombiesRun', '0'),
          DropOnDeath: setting('DropOnDeath', '1'),
          BuildCreate: setting('BuildCreate', 'false'),
        };
        const lines = Object.entries(properties)
          .map(([key, value]) => `  <property name="${key}" value="${value}"/>`)
          .join('\n');

        await fs.mkdir(hostPaths.server!, { recursive: true });
        await fs.writeFile(
          path.join(hostPaths.server!, 'serverconfig.xml'),
          `<?xml version="1.0"?>\n<ServerSettings>\n${lines}\n</ServerSettings>\n`,
          'utf8',
        );
      },
    };
  },
};
