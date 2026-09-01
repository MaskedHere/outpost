import path from 'node:path';
import fs from 'node:fs/promises';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify from 'fastify';
import { config } from './config.js';
import { authPlugin } from './auth/plugin.js';
import { authRoutes } from './routes/auth.js';
import { serverRoutes } from './routes/servers.js';
import { consoleRoutes } from './routes/console.js';
import { fileRoutes } from './routes/files.js';
import { backupRoutes } from './routes/backups.js';
import { modpackRoutes } from './routes/modpacks.js';
import { curseforgeRoutes } from './routes/curseforge.js';
import { settingsRoutes } from './routes/settings.js';
import { contentCacheRoutes } from './routes/contentCache.js';
import { pluginRoutes } from './routes/plugins.js';
import { worldRoutes } from './routes/world.js';
import { steamWorkshopRoutes } from './routes/steamWorkshop.js';

async function main() {
  await fs.mkdir(config.serversDir, { recursive: true });
  await fs.mkdir(config.backupsDir, { recursive: true });
  await fs.mkdir(config.configDir, { recursive: true });
  await fs.mkdir(config.gameCacheDir, { recursive: true });

  // Sessions are signed with this — on the default value anyone who knows Outpost is open source
  // can mint a valid admin cookie. Fine (and convenient) for local development; refusing to boot
  // in production is what stops a NAS install from silently going out with it unchanged.
  if (process.env.NODE_ENV === 'production' && config.jwtSecret === 'dev-secret-change-me') {
    console.error(
      'Refusing to start: JWT_SECRET is still the built-in development default.\n' +
        'Set JWT_SECRET to a long random string (e.g. `openssl rand -hex 32`) and restart.',
    );
    process.exit(1);
  }

  const app = Fastify({ logger: true, bodyLimit: 10 * 1024 * 1024 });

  // Unauthenticated on purpose — it's what the container HEALTHCHECK polls, and it reports nothing
  // beyond "the process is up".
  app.get('/api/health', async () => ({ ok: true }));

  await app.register(fastifyCors, { origin: true, credentials: true });
  await app.register(fastifyCookie);
  await app.register(fastifyMultipart, { limits: { fileSize: 200 * 1024 * 1024 } });
  await app.register(fastifyWebsocket);
  await app.register(authPlugin);

  await app.register(authRoutes);
  await app.register(serverRoutes);
  await app.register(consoleRoutes);
  await app.register(fileRoutes);
  await app.register(backupRoutes);
  await app.register(modpackRoutes);
  await app.register(curseforgeRoutes);
  await app.register(settingsRoutes);
  await app.register(pluginRoutes);
  await app.register(worldRoutes);
  await app.register(steamWorkshopRoutes);
  await app.register(contentCacheRoutes);

  // In production the frontend is built into apps/frontend/dist and served from the same
  // container/port as the API — this is what makes Outpost a single ZimaOS app.
  const frontendDist = path.resolve(process.cwd(), '../frontend/dist');
  if (
    await fs
      .access(frontendDist)
      .then(() => true)
      .catch(() => false)
  ) {
    await app.register(fastifyStatic, { root: frontendDist });
    app.setNotFoundHandler((request, reply) => {
      if (request.raw.url?.startsWith('/api') || request.raw.url?.startsWith('/ws')) {
        return reply.code(404).send({ error: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  await app.listen({ port: config.port, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
