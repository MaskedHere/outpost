import type { GameDefinition } from './types.js';

// lloesche/valheim-server: https://github.com/lloesche/valheim-server-docker
// The de facto standard Valheim server image.
const IMAGE = 'lloesche/valheim-server';

export const valheimDefinition: GameDefinition = {
  id: 'valheim',
  displayName: 'Valheim',
  variants: ['default'],
  versionLabel: null,
  moddable: false,
  steamAppId: 892970,
  gamePortProtocol: 'udp',
  // lloesche's own image healthchecks off this exact line.
  readyLogPattern: /Game server connected/,
  // /opt/valheim holds the SteamCMD server install; per-server state (worlds, backups, mod config)
  // lives in /config.
  contentCache: { subdir: 'server', approxSizeLabel: '~1.5 GB' },
  settings: [
    {
      key: 'SERVER_PASS',
      label: 'Join password',
      info: "Valheim requires a password of at least 5 characters and refuses to start without one, so this can't be blank. Defaults to a random one shown on this server's page.",
      type: 'text',
      default: '',
      group: 'Access',
    },
    {
      key: 'SERVER_PUBLIC',
      label: 'List publicly',
      info: "Off by default. On, the server appears in Valheim's in-game community browser — anyone can find it, though the password still applies. Off means players join by entering the address directly.",
      type: 'toggle',
      default: 'false',
      onValue: 'true',
      offValue: 'false',
      group: 'Access',
    },
    {
      key: 'WORLD_NAME',
      label: 'World name',
      info: 'Names the save file. Changing this on an existing server starts a brand-new empty world rather than renaming the old one — the previous world stays on disk and is reachable by changing this back.',
      type: 'text',
      default: 'Dedicated',
      group: 'World',
    },
    {
      key: 'SERVER_PRESET',
      label: 'World preset',
      info: 'Sets the overall difficulty/resource rules for the world. Normal is the standard experience; Casual and Easy soften combat and death penalties, Hard and Hardcore sharpen them.',
      type: 'select',
      default: 'normal',
      options: [
        { value: 'casual', label: 'Casual' },
        { value: 'easy', label: 'Easy' },
        { value: 'normal', label: 'Normal' },
        { value: 'hard', label: 'Hard' },
        { value: 'hardcore', label: 'Hardcore' },
      ],
      group: 'Gameplay',
    },
    {
      key: 'SERVER_CROSSPLAY',
      label: 'Crossplay',
      info: 'Lets players on Xbox/Microsoft Store join alongside Steam players. Off keeps the server Steam-only, which is slightly more reliable to connect to.',
      type: 'toggle',
      default: 'false',
      onValue: 'true',
      offValue: 'false',
      group: 'Access',
    },
  ],

  buildContainerSpec({ name, containerName, dataPath, memoryMb, rconPassword, extraSettings }) {
    const setting = (key: string, fallback: string) => extraSettings?.[key] ?? fallback;
    // Valheim has no RCON, but every server still gets a random rconPassword generated.
    return {
      image: IMAGE,
      containerName,
      env: [
        `SERVER_NAME=${name}`,
        `WORLD_NAME=${setting('WORLD_NAME', 'Dedicated')}`,
        // Valheim rejects passwords shorter than 5 characters, so a short or empty custom password
        // falls back to the generated secret.
        `SERVER_PASS=${setting('SERVER_PASS', '').length >= 5 ? setting('SERVER_PASS', '') : rconPassword.slice(0, 10)}`,
        `SERVER_PUBLIC=${setting('SERVER_PUBLIC', 'false')}`,
        `SERVER_PRESET=${setting('SERVER_PRESET', 'normal')}`,
        `SERVER_CROSSPLAY=${setting('SERVER_CROSSPLAY', 'false')}`,
      ],
      ports: [{ containerPort: 2456, protocol: 'udp', purpose: 'game' }],
      volumes: [
        { hostSubdir: 'config', containerPath: '/config' },
        { hostSubdir: 'server', containerPath: '/opt/valheim' },
      ],
      memoryMb,
      dataPath,
    };
  },
};
