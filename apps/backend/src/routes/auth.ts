import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { signSession } from '../auth/jwt.js';
import { requireAuth, SESSION_COOKIE_NAME } from '../auth/plugin.js';

const credentialsSchema = z.object({
  username: z.string().min(3).max(32),
  password: z.string().min(8).max(200),
});

// Login uses a plain bcrypt compare, not the setup/update strength policy, so accounts created
// under an older policy aren't locked out.
const loginSchema = z.object({
  username: z.string().min(1).max(32),
  password: z.string().min(1).max(200),
});

// No strength minimum.
const updateAccountSchema = z.object({
  username: z.string().min(3).max(32).optional(),
  newPassword: z.string().min(1).max(200).optional(),
  currentPassword: z.string().min(1),
});

const COOKIE_OPTS = {
  path: '/',
  httpOnly: true,
  sameSite: 'lax' as const,
  maxAge: 60 * 60 * 24 * 30,
};

export async function authRoutes(app: FastifyInstance) {
  app.get('/api/auth/status', async (request) => {
    const userCount = await prisma.user.count();
    return {
      needsSetup: userCount === 0,
      authenticated: Boolean(request.user),
      username: request.user?.username ?? null,
    };
  });

  app.post('/api/auth/setup', async (request, reply) => {
    const userCount = await prisma.user.count();
    if (userCount > 0) {
      return reply.code(409).send({ error: 'Setup already completed' });
    }

    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
    }

    const { username, password } = parsed.data;
    const user = await prisma.user.create({
      data: { username, passwordHash: await hashPassword(password) },
    });

    const token = signSession({ userId: user.id, username: user.username });
    reply.setCookie(SESSION_COOKIE_NAME, token, COOKIE_OPTS);
    return { username: user.username };
  });

  app.post('/api/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid credentials' });
    }

    const { username, password } = parsed.data;
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return reply.code(401).send({ error: 'Invalid username or password' });
    }

    const token = signSession({ userId: user.id, username: user.username });
    reply.setCookie(SESSION_COOKIE_NAME, token, COOKIE_OPTS);
    return { username: user.username };
  });

  app.post('/api/auth/logout', async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return { ok: true };
  });

  // Re-issues the session cookie on a successful change since username/password are both baked into
  // the signed session payload.
  app.patch('/api/auth/account', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = updateAccountSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });

    const user = await prisma.user.findUnique({ where: { id: request.user!.userId } });
    if (!user) return reply.code(401).send({ error: 'Not authenticated' });

    if (!(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
      return reply.code(401).send({ error: 'Current password is incorrect' });
    }

    if (parsed.data.username && parsed.data.username !== user.username) {
      const clash = await prisma.user.findUnique({ where: { username: parsed.data.username } });
      if (clash) return reply.code(409).send({ error: 'That username is already taken' });
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(parsed.data.username && { username: parsed.data.username }),
        ...(parsed.data.newPassword && {
          passwordHash: await hashPassword(parsed.data.newPassword),
        }),
      },
    });

    const token = signSession({ userId: updated.id, username: updated.username });
    reply.setCookie(SESSION_COOKIE_NAME, token, COOKIE_OPTS);
    return { username: updated.username };
  });
}
