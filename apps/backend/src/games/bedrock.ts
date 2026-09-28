import type { GameDefinition } from './types.js';

// itzg/minecraft-bedrock-server: https://github.com/itzg/docker-minecraft-bedrock-server
// From the same maintainer as the Java image Outpost already uses.
const IMAGE = 'itzg/minecraft-bedrock-server:latest';

export const bedrockDefinition: GameDefinition = {
  id: 'bedrock',
  displayName: 'Minecraft: Bedrock Edition',
  variants: ['default'],
  versionLabel: 'Version',
  versionPlaceholder: 'LATEST',
  // Bedrock uses add-ons (behavior/resource packs) instead of the Java loader + jar model, so no
  // mod step is offered.
  moddable: false,
  // Minecraft is not on Steam, so there is no banner artwork to pull.
  gamePortProtocol: 'udp',
  // Mojang's server prints this once the world is loaded and it is accepting joins.
  readyLogPattern: /Server started\./,
  // First boot downloads the server binary from Mojang before anything else happens, which on a
  // slow link looks identical to a hang.
  installingLogPattern: /Downloading Bedrock server|Looking up latest version/i,
  // No `players` block: Bedrock has no RCON (the image drives its console over stdin), so players
  // can't be listed, kicked, or banned from here.
  settings: [
    {
      key: 'MAX_PLAYERS',
      label: 'Max players',
      info: "How many people can be connected at once. Bedrock's own default is 10.",
      type: 'number',
      default: '10',
      min: 1,
      max: 100,
      group: 'Capacity',
    },
    {
      key: 'ONLINE_MODE',
      label: 'Require Xbox Live sign-in',
      info: "On by default, and worth keeping on: it verifies each player against Xbox Live so nobody can connect under someone else's gamertag. Turning it off lets unauthenticated clients join.",
      type: 'toggle',
      default: 'true',
      onValue: 'true',
      offValue: 'false',
      group: 'Access',
    },
    {
      key: 'DEFAULT_PLAYER_PERMISSION_LEVEL',
      label: 'New players join as',
      info: 'The permission level someone gets the first time they connect. "Visitor" can look but not build, which is the usual choice for a public server.',
      type: 'select',
      default: 'member',
      options: [
        { value: 'visitor', label: 'Visitor — cannot build' },
        { value: 'member', label: 'Member — normal play' },
        { value: 'operator', label: 'Operator — full commands' },
      ],
      group: 'Access',
    },
    {
      key: 'GAMEMODE',
      label: 'Game mode',
      info: 'The mode players start in when they first join.',
      type: 'select',
      default: 'survival',
      options: [
        { value: 'survival', label: 'Survival' },
        { value: 'creative', label: 'Creative' },
        { value: 'adventure', label: 'Adventure' },
      ],
      group: 'Gameplay',
    },
    {
      key: 'DIFFICULTY',
      label: 'Difficulty',
      info: 'Peaceful stops hostile mobs spawning entirely.',
      type: 'select',
      default: 'easy',
      options: [
        { value: 'peaceful', label: 'Peaceful' },
        { value: 'easy', label: 'Easy' },
        { value: 'normal', label: 'Normal' },
        { value: 'hard', label: 'Hard' },
      ],
      group: 'Gameplay',
    },
    {
      key: 'ALLOW_CHEATS',
      label: 'Allow cheats',
      info: 'Enables commands like /gamemode and /give for operators. Off by default.',
      type: 'toggle',
      default: 'false',
      onValue: 'true',
      offValue: 'false',
      group: 'Gameplay',
    },
    {
      key: 'PLAYER_IDLE_TIMEOUT',
      label: 'Kick idle players after (minutes)',
      info: 'Disconnects players who have not moved for this long, freeing a slot. 0 disables it.',
      type: 'number',
      default: '30',
      min: 0,
      max: 1440,
      group: 'Gameplay',
    },
    {
      key: 'TEXTUREPACK_REQUIRED',
      label: 'Require the server resource pack',
      info: 'Forces players to accept any resource pack the server ships before they can join. Only matters if you have added one.',
      type: 'toggle',
      default: 'false',
      onValue: 'true',
      offValue: 'false',
      group: 'Gameplay',
    },
    {
      key: 'VIEW_DISTANCE',
      label: 'View distance (chunks)',
      info: 'How far players can see. This is the single biggest lever on server load — dropping it is the first thing to try if the world feels laggy.',
      type: 'number',
      default: '32',
      min: 5,
      max: 64,
      group: 'Performance',
    },
    {
      key: 'TICK_DISTANCE',
      label: 'Simulation distance (chunks)',
      info: 'How far from each player the world keeps actually running — mobs moving, crops growing, redstone firing. Bedrock allows 4 to 12.',
      type: 'number',
      default: '4',
      min: 4,
      max: 12,
      group: 'Performance',
    },
    {
      key: 'LEVEL_NAME',
      label: 'World name',
      info: 'Names the world folder on disk. Changing it on an existing server starts a brand new world rather than renaming the old one.',
      type: 'text',
      default: 'Bedrock level',
      group: 'World',
      newWorldOnly: true,
    },
    {
      key: 'LEVEL_SEED',
      label: 'World seed',
      info: 'Leave blank for a random world. Only read when the world is first generated.',
      type: 'text',
      default: '',
      group: 'World',
      newWorldOnly: true,
    },
  ],

  buildContainerSpec({ name, containerName, dataPath, memoryMb, version, extraSettings }) {
    const setting = (key: string, fallback: string) => extraSettings?.[key] ?? fallback;

    const env = [
      // Mojang's server refuses to start without this, and Outpost only ever creates a server on an
      // explicit user action.
      'EULA=TRUE',
      `VERSION=${version?.trim() || 'LATEST'}`,
      `SERVER_NAME=${name.replace(/[^\w .-]/g, '') || 'Outpost Server'}`,
      'SERVER_PORT=19132',
      `MAX_PLAYERS=${setting('MAX_PLAYERS', '10')}`,
      `ONLINE_MODE=${setting('ONLINE_MODE', 'true')}`,
      `DEFAULT_PLAYER_PERMISSION_LEVEL=${setting('DEFAULT_PLAYER_PERMISSION_LEVEL', 'member')}`,
      `GAMEMODE=${setting('GAMEMODE', 'survival')}`,
      `DIFFICULTY=${setting('DIFFICULTY', 'easy')}`,
      `ALLOW_CHEATS=${setting('ALLOW_CHEATS', 'false')}`,
      `PLAYER_IDLE_TIMEOUT=${setting('PLAYER_IDLE_TIMEOUT', '30')}`,
      `TEXTUREPACK_REQUIRED=${setting('TEXTUREPACK_REQUIRED', 'false')}`,
      `VIEW_DISTANCE=${setting('VIEW_DISTANCE', '32')}`,
      `TICK_DISTANCE=${setting('TICK_DISTANCE', '4')}`,
      `LEVEL_NAME=${setting('LEVEL_NAME', 'Bedrock level')}`,
    ];

    // Sent only when set: a blank seed in server.properties is already what "random" means, so
    // omitting it keeps the generated file matching a stock one.
    const seed = setting('LEVEL_SEED', '').trim();
    if (seed) env.push(`LEVEL_SEED=${seed}`);

    return {
      image: IMAGE,
      containerName,
      env,
      ports: [{ containerPort: 19132, protocol: 'udp', purpose: 'game' }],
      volumes: [{ hostSubdir: '', containerPath: '/data' }],
      memoryMb,
      dataPath,
    };
  },
};
