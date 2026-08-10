import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifySession, type SessionPayload } from './jwt.js';

const COOKIE_NAME = 'outpost_session';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionPayload | null;
  }
}

export const authPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('user', null);

  app.addHook('onRequest', async (request: FastifyRequest) => {
    const token = request.cookies[COOKIE_NAME];
    request.user = token ? verifySession(token) : null;
  });
});

export function requireAuth(request: FastifyRequest, reply: FastifyReply, done: () => void) {
  if (!request.user) {
    reply.code(401).send({ error: 'Not authenticated' });
    return;
  }
  done();
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
