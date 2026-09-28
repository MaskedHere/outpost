import type { GameDefinition } from './types.js';

// ghcr.io/beardedio/terraria: https://github.com/beardedio/terraria
// Vanilla Terraria has no RCON and its console needs a real TTY, so this server is logs-only. The
// first world is created with -autocreate launch args, because the entrypoint refuses to start when
// `world` points at a missing file.
const IMAGE = 'ghcr.io/beardedio/terraria:vanilla-latest';

// jacobsmile/tmodloader1.4: https://github.com/JACOBSMILE/tmodloader1.4
// Vanilla Terraria cannot load mods at all, and the image above publishes only vanilla and TShock
// tags.
const TMODLOADER_IMAGE = 'jacobsmile/tmodloader1.4:latest';

export const terrariaDefinition: GameDefinition = {
  id: 'terraria',
  displayName: 'Terraria',
  variants: ['default', 'tmodloader'],
  variantLabels: { default: 'Vanilla', tmodloader: 'tModLoader' },
  versionLabel: null,
  moddable: true,
  moddingKind: 'workshop-items',
  moddedVariants: ['tmodloader'],
  // tModLoader enables mods by their Workshop ID, so there is no second identifier to ask for.
  workshopRequiresModIds: false,
  steamAppId: 105600,
  // Terraria's Workshop holds worlds and resource packs; tModLoader mods live under tModLoader's
  // own app id, which TMOD_AUTODOWNLOAD expects.
  workshopAppId: 1281930,
  gamePortProtocol: 'tcp',
  // No RCON means the generic readiness check would otherwise fall back to raw-TCP-probing the game
  // port itself.
  readyLogPattern: /Server started/,
  settings: [
    {
      key: 'maxplayers',
      label: 'Max players',
      info: "Terraria's own cap is 255, but the vanilla server gets unstable well before that — 8-16 is the normal range for a friends server.",
      type: 'number',
      default: '8',
      min: 1,
      max: 255,
      group: 'Capacity',
    },
    {
      key: 'password',
      label: 'Join password',
      info: "Players are asked for this when connecting. Blank means anyone who knows the address can join. Defaults to a random password shown on this server's page.",
      type: 'text',
      default: '',
      group: 'Access',
    },
    {
      key: 'difficulty',
      label: 'World difficulty',
      info: 'Baked into the world when it is first generated — changing it later has no effect on an existing world. Journey is the creative/experimental mode; Master is the hardest.',
      type: 'select',
      default: '0',
      options: [
        { value: '0', label: 'Classic' },
        { value: '1', label: 'Expert' },
        { value: '2', label: 'Master' },
        { value: '3', label: 'Journey' },
      ],
      group: 'World generation',
      newWorldOnly: true,
    },
    {
      key: 'autocreate',
      label: 'World size',
      info: 'Only used when generating a brand-new world. Bigger worlds take noticeably longer to generate on first boot and use more memory, but hold more biomes and loot.',
      type: 'select',
      default: '1',
      options: [
        { value: '1', label: 'Small' },
        { value: '2', label: 'Medium' },
        { value: '3', label: 'Large' },
      ],
      group: 'World generation',
      newWorldOnly: true,
    },
  ],

  buildContainerSpec({
    name,
    containerName,
    dataPath,
    memoryMb,
    variant,
    rconPassword,
    workshopItemIds,
    extraSettings,
  }) {
    const setting = (key: string, fallback: string) => extraSettings?.[key] ?? fallback;
    const joinPassword = setting('password', '') || rconPassword.slice(0, 12);

    if (variant === 'tmodloader') {
      // Downloading a mod and enabling it are separate lists in this image.
      const ids = (workshopItemIds ?? []).join(',');
      const env = [
        'TMOD_PORT=7777',
        `TMOD_MAXPLAYERS=${setting('maxplayers', '8')}`,
        `TMOD_PASS=${joinPassword}`,
        `TMOD_MOTD=${name}`,
        'TMOD_WORLDNAME=world',
        // Same 1/2/3 and 0-3 scales the vanilla launch args use, so the shared settings above carry
        // over to this variant unchanged.
        `TMOD_WORLDSIZE=${setting('autocreate', '1')}`,
        `TMOD_DIFFICULTY=${setting('difficulty', '0')}`,
      ];
      if (ids) {
        env.push(`TMOD_AUTODOWNLOAD=${ids}`);
        env.push(`TMOD_ENABLEDMODS=${ids}`);
      }

      return {
        image: TMODLOADER_IMAGE,
        containerName,
        env,
        ports: [{ containerPort: 7777, protocol: 'tcp', purpose: 'game' }],
        // This image keeps worlds and the Workshop mod cache under /data, not the vanilla /config.
        volumes: [{ hostSubdir: '', containerPath: '/data' }],
        memoryMb,
        dataPath,
      };
    }

    // Terraria takes everything as launch args.
    return {
      image: IMAGE,
      containerName,
      env: [],
      cmd: [
        '-world',
        '/config/world.wld',
        '-autocreate',
        setting('autocreate', '1'),
        '-worldname',
        'world',
        '-difficulty',
        setting('difficulty', '0'),
        '-maxplayers',
        setting('maxplayers', '8'),
        '-port',
        '7777',
        '-password',
        joinPassword,
        '-motd',
        name,
      ],
      ports: [{ containerPort: 7777, protocol: 'tcp', purpose: 'game' }],
      volumes: [{ hostSubdir: '', containerPath: '/config' }],
      memoryMb,
      dataPath,
    };
  },
};
