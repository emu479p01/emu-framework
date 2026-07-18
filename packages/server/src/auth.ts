import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { DataContext } from '@emu/core';

const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours
export const MIN_PASSWORD_LENGTH = 12;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 32);
  return timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

export interface AuthUser {
  username: string;
  displayName: string;
}

/** Validates credentials and creates a DB session; returns the token or null. */
export function login(ctx: DataContext, username: string, password: string): string | null {
  const user = ctx.select('FW_User').whereEq({ username }).firstOnly();
  if (!user || !user.f.enabled) return null;
  if (!verifyPassword(password, user.f.passwordHash as string)) return null;

  const token = randomUUID() + randomBytes(16).toString('hex');
  ctx
    .newRecord('FW_Session')
    .setMany({
      token,
      username,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    })
    .insert();
  return token;
}

export function createSession(ctx: DataContext, username: string): string {
  const token = randomUUID() + randomBytes(16).toString('hex');
  ctx.newRecord('FW_Session').setMany({
    token,
    username,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  }).insert();
  return token;
}

export function revokeSessions(ctx: DataContext, username: string): void {
  for (const session of ctx.select('FW_Session').whereEq({ username }).toArray()) session.delete();
}

export function logout(ctx: DataContext, token: string): void {
  const session = ctx.select('FW_Session').whereEq({ token }).firstOnly();
  session?.delete();
}

export function resolveSession(ctx: DataContext, token: string | undefined): AuthUser | null {
  if (!token) return null;
  const session = ctx.select('FW_Session').whereEq({ token }).firstOnly();
  if (!session) return null;
  if (new Date(session.f.expiresAt as string) < new Date()) {
    session.delete();
    return null;
  }
  const user = ctx.select('FW_User').whereEq({ username: session.f.username }).firstOnly();
  if (!user || !user.f.enabled) return null;
  return {
    username: user.f.username as string,
    displayName: (user.f.displayName as string) ?? (user.f.username as string),
  };
}
