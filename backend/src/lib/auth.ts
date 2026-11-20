import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { HttpError } from './http.js';

export type Role = 'CONSUMER' | 'FARMER' | 'DELIVERY' | 'ADMIN';

export interface AuthUser {
  id: string;
  role: Role;
  name: string;
  sessionId: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export async function createSession(userId: string) {
  const expiresAt = new Date(Date.now() + config.tokenTtlHours * 3600_000);
  const session = await prisma.session.create({ data: { userId, expiresAt } });
  return session;
}

export function signToken(user: { id: string; role: string }, sessionId: string) {
  return jwt.sign({ sub: user.id, role: user.role, sid: sessionId }, config.jwtSecret, {
    expiresIn: `${config.tokenTtlHours}h`,
  });
}

function bearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  return h.slice(7);
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = bearer(req);
    if (!token) throw new HttpError(401, 'Please log in to continue');
    let payload: { sub: string; sid: string };
    try {
      payload = jwt.verify(token, config.jwtSecret) as { sub: string; sid: string };
    } catch {
      throw new HttpError(401, 'Your session has expired. Please log in again');
    }
    const session = await prisma.session.findUnique({ where: { id: payload.sid }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt < new Date() || session.userId !== payload.sub) {
      throw new HttpError(401, 'Your session has ended. Please log in again');
    }
    const u = session.user;
    if (u.status === 'BLOCKED') throw new HttpError(403, 'Your account has been blocked. Contact support');
    if (u.status !== 'ACTIVE') throw new HttpError(403, 'Your account is not active');
    req.user = { id: u.id, role: u.role as Role, name: u.name, sessionId: session.id };
    next();
  } catch (e) {
    next(e);
  }
}

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, 'Please log in to continue'));
    if (!roles.includes(req.user.role)) return next(new HttpError(403, 'You do not have access to this resource'));
    next();
  };

export const guard = (...roles: Role[]) => [authenticate, requireRole(...roles)];

export function me(req: Request): AuthUser {
  if (!req.user) throw new HttpError(401, 'Please log in to continue');
  return req.user;
}
