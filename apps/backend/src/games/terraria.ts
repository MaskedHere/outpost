import type { GameDefinition } from './types.js';

// ghcr.io/beardedio/terraria: https://github.com/beardedio/terraria
// Vanilla Terraria has no RCON and its dedicated server needs a real TTY for its interactive
// console (confirmed: the image's own docs note a NullReferenceException without one) — so
// Outpost never attaches to its stdin, and this is logs-only. The image's own entrypoint refuses
// to start at all if the `world` env var points at a file that doesn't exist yet, so first boot
// is done by deliberately NOT setting `world` and instead passing -autocreate/-world/-worldname
// directly as launch args, which TerrariaServer itself handles non-interactively.
const IMAGE = 'ghcr.io/beardedio/terraria:vanilla-latest';

export const terrariaDefinition: GameDefinition = {
  id: 'terraria',
  displayName: 'Terraria',
  variants: ['default'],
  versionLabel: null,
  moddable: false,
  steamAppId: 105600,
  gamePortProtocol: 'tcp',
  // No RCON means the generic readiness check would otherwise fall back to raw-TCP-probing the
  // game port itself — which for Terraria is actively harmful, not just a wasted check: the
  // server treats *any* new TCP connection on 7777 as a player connecting, so every poll made it
  // log "<host> is connecting...", immediately drop the "player" moments later, and run a full
  // save/validate/backup cycle in response — confirmed live via `docker logs`, where this produced
  // an unbroken loop of save cycles a few seconds apart. "Server started" is the line
  // TerrariaServer itself prints once the world's finished loading and it's actually accepting
  // connections, so matching that avoids ever touching the game port for a health check.
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

  buildContainerSpec({ name, containerName, dataPath, memoryMb, rconPassword, extraSettings }) {
    const setting = (key: string, fallback: string) => extraSettings?.[key] ?? fallback;
    // Terraria takes everything as launch args — there are no env vars to set here.
    return {
      image: IMAGE,
      containerName,
      env: [],
      cmd: [
        '-world', '/config/world.wld',
        '-autocreate', setting('autocreate', '1'),
        '-worldname', 'world',
        '-difficulty', setting('difficulty', '0'),
        '-maxplayers', setting('maxplayers', '8'),
        '-port', '7777',
        '-password', setting('password', '') || rconPassword.slice(0, 12),
        '-motd', name,
      ],
      ports: [{ containerPort: 7777, protocol: 'tcp', purpose: 'game' }],
      volumes: [{ hostSubdir: '', containerPath: '/config' }],
      memoryMb,
      dataPath,
    };
  },
};
