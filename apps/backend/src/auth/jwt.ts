import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export interface SessionPayload {
  userId: string;
  username: string;
}

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '30d' });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, config.jwtSecret) as SessionPayload;
  } catch {
    return null;
  }
}
