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

export const config = {
  port: Number(process.env.PORT ?? 3000),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  dataDir: DATA_DIR,
  serversDir: path.join(DATA_DIR, 'servers'),
  backupsDir: path.join(DATA_DIR, 'backups'),
  configDir: path.join(DATA_DIR, 'config'),
  dockerSocketPath: process.env.DOCKER_SOCKET ?? (process.platform === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock'),
  modrinthApiBase: 'https://api.modrinth.com/v2',
  minecraftPortRangeStart: Number(process.env.MC_PORT_RANGE_START ?? 25565),
};
