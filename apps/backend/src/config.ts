import path from 'node:path';

// Prisma's CLI auto-loads apps/backend/.env, but process.env doesn't, so load it explicitly. In
// Docker, env vars come from docker-compose and no .env file exists.
try {
  process.loadEnvFile();
} catch {
  // No .env file; expected in production.
}

// On a real ZimaOS install this is bind-mounted to /DATA/AppData/outpost (see
// packaging/docker-compose.yml).
const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), '../../.data');

// Where DATA_DIR lives on the Docker *host*.
const HOST_DATA_DIR = process.env.HOST_DATA_DIR ?? DATA_DIR;

export const config = {
  port: Number(process.env.PORT ?? 3000),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  dataDir: DATA_DIR,
  hostDataDir: HOST_DATA_DIR,
  serversDir: path.join(DATA_DIR, 'servers'),
  // Mod jars Outpost couldn't identify on Modrinth at all (by hash or by name) but that arrived as
  // real bytes in an imported zip.
  packsDir: path.join(DATA_DIR, 'packs'),
  backupsDir: path.join(DATA_DIR, 'backups'),
  configDir: path.join(DATA_DIR, 'config'),
  // One shared copy per game of the large engine/content files that SteamCMD images would otherwise
  // re-download for every new server.
  gameCacheDir: path.join(DATA_DIR, 'game-cache'),
  dockerSocketPath:
    process.env.DOCKER_SOCKET ??
    (process.platform === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock'),
  // RCON ports are published on the Docker host, which isn't "localhost" from inside the Outpost
  // container (see RCON_HOST in docker-compose.yml).
  rconHost: process.env.RCON_HOST ?? 'localhost',
  modrinthApiBase: 'https://api.modrinth.com/v2',
  minecraftPortRangeStart: Number(process.env.MC_PORT_RANGE_START ?? 25565),
};

/**
 * Maps a path inside the Outpost container to the equivalent Docker host path, for use as a
 * bind-mount source (see HOST_DATA_DIR).
 */
export function toHostPath(localPath: string): string {
  if (config.hostDataDir === config.dataDir) return localPath;
  const relative = path.relative(config.dataDir, localPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return localPath;
  return path.posix.join(config.hostDataDir, ...relative.split(path.sep));
}
