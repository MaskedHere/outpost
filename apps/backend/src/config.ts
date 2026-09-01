import path from 'node:path';

// Prisma's own CLI auto-loads apps/backend/.env, but our own process.env reads below don't get
// that for free — load it explicitly. In production (Docker) there's no .env file and env vars
// come from docker-compose instead, so a missing file here is expected, not an error.
try {
  process.loadEnvFile();
} catch {
  // no .env file present — fine in production
}

// On a real ZimaOS install this is bind-mounted to /DATA/AppData/outpost (see packaging/docker-compose.yml).
// Locally it defaults to a .data folder at the repo root so `npm run dev` works without any setup.
const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), '../../.data');

// Where DATA_DIR actually lives on the Docker *host*. Outpost creates game-server containers
// through the host's Docker socket, and the daemon resolves every bind-mount source against the
// host filesystem — not against Outpost's own container. So a bind source of "/data/servers/x"
// makes the daemon look for "/data" on the host, where it doesn't exist (on ZimaOS that fails as
// `mkdir /data: read-only file system`). Setting this to the host side of the /data bind mount lets
// Outpost translate its own paths back to host paths when creating containers. Unset locally, where
// Outpost runs directly on the host and the two are already the same path.
const HOST_DATA_DIR = process.env.HOST_DATA_DIR ?? DATA_DIR;

export const config = {
  port: Number(process.env.PORT ?? 3000),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  dataDir: DATA_DIR,
  hostDataDir: HOST_DATA_DIR,
  serversDir: path.join(DATA_DIR, 'servers'),
  // Mod jars Outpost couldn't identify on Modrinth at all (by hash or by name) but that arrived as
  // real bytes in an imported zip — kept verbatim so the pack still deploys correctly instead of
  // silently dropping mods just because Outpost can't name them. See modrinth/import.ts.
  packsDir: path.join(DATA_DIR, 'packs'),
  backupsDir: path.join(DATA_DIR, 'backups'),
  configDir: path.join(DATA_DIR, 'config'),
  // One shared copy per game of the big, identical-for-everyone engine/content files that
  // SteamCMD-backed images otherwise re-download from Steam in full for every single new server
  // (Garry's Mod alone is 6.87GB, measured live). Populated once, then copied into each new
  // server's own data dir — see services/contentCacheService.ts.
  gameCacheDir: path.join(DATA_DIR, 'game-cache'),
  dockerSocketPath: process.env.DOCKER_SOCKET ?? (process.platform === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock'),
  // Game-server RCON ports are published on the Docker *host*, not reachable via "localhost" from
  // inside Outpost's own sibling container in production (see docker-compose.yml's RCON_HOST +
  // extra_hosts: host.docker.internal:host-gateway). Local `npm run dev` has no wrapping
  // container, so plain localhost is correct there.
  rconHost: process.env.RCON_HOST ?? 'localhost',
  modrinthApiBase: 'https://api.modrinth.com/v2',
  minecraftPortRangeStart: Number(process.env.MC_PORT_RANGE_START ?? 25565),
};

/** Rewrites a path inside Outpost's own filesystem to the equivalent path on the Docker host, for
 *  use as a bind-mount source (see HOST_DATA_DIR above for why that distinction matters). Returns
 *  the path unchanged when the two roots are identical (local development), or when the path falls
 *  outside DATA_DIR entirely and therefore has no known host equivalent to map it to.
 *
 *  Always emits POSIX separators: the daemon this string is sent to is Linux even when Outpost
 *  itself is running on Windows during development. */
export function toHostPath(localPath: string): string {
  if (config.hostDataDir === config.dataDir) return localPath;
  const relative = path.relative(config.dataDir, localPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return localPath;
  return path.posix.join(config.hostDataDir, ...relative.split(path.sep));
}
