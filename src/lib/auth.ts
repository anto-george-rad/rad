import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { db, schema } from '@/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { DeskRole, RolePermissions, TicketScope } from '@/db/schema';

export const SESSION_COOKIE = 'rd_session';
export function authSecret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 24 || s === 'change-me-to-a-long-random-string') {
    if (process.env.NODE_ENV === 'production') throw new Error('AUTH_SECRET is missing or too short. Set a long random value (openssl rand -base64 48).');
    return new TextEncoder().encode('dev-only-secret-not-for-production-use');
  }
  return new TextEncoder().encode(s);
}

export type SessionUser = { id: string; name: string; email: string; role: 'admin' | 'manager' | 'rep'; theme: string; crmAccess: boolean; deskRole: DeskRole; ticketScope: TicketScope; sid: string; perms: RolePermissions; customRole: string | null };
/** What the base role allows; a custom role can only take rights away from this, never add. */
export function basePerms(role: 'admin' | 'manager' | 'rep', deskRole: DeskRole): RolePermissions {
  const notRep = role !== 'rep';
  return { exportData: notRep, importData: notRep, deleteRecords: true, viewCost: true, bulkEdit: true, viewInsights: true, deleteTickets: deskRole === 'admin', mergeTickets: deskRole === 'admin' || deskRole === 'agent' };
}
export function narrowPerms(base: RolePermissions, custom: Partial<RolePermissions> | null | undefined): RolePermissions {
  if (!custom) return base;
  const out = { ...base }; for (const k of Object.keys(base) as (keyof RolePermissions)[]) if (custom[k] === false) out[k] = false; return out;
}

/** Starts a session: one row per device so people can see and end sessions individually. */
export async function createSession(u: { id: string; sessionVersion: number }) {
  const h = headers();
  const [s] = await db.insert(schema.sessions).values({ userId: u.id, userAgent: (h.get('user-agent') || '').slice(0, 300), ip: (h.get('x-forwarded-for') || h.get('x-real-ip') || '').split(',')[0].trim().slice(0, 60) || null }).returning();
  const token = await new SignJWT({ sub: u.id, v: u.sessionVersion, sid: s.id }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('14d').sign(authSecret());
  cookies().set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' && process.env.INSECURE_COOKIES !== 'true', path: '/', maxAge: 60 * 60 * 24 * 14 });
  return s.id;
}
export async function destroySession() {
  const u = await getUser().catch(() => null);
  if (u?.sid) await db.update(schema.sessions).set({ revokedAt: new Date() }).where(eq(schema.sessions.id, u.sid));
  cookies().delete(SESSION_COOKIE);
}
/** A short-lived token proving the password step passed, while the 2FA code is pending. */
export async function pendingTwoFactor(userId: string) {
  return new SignJWT({ sub: userId, p: '2fa' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('5m').sign(authSecret());
}
export async function readPendingTwoFactor(token: string) {
  try { const { payload } = await jwtVerify(token, authSecret()); return payload.p === '2fa' ? String(payload.sub) : null; } catch { return null; }
}

export async function getUser(): Promise<SessionUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, authSecret());
    const u = await db.query.users.findFirst({ where: eq(schema.users.id, String(payload.sub)) });
    // A bumped sessionVersion (password change, reset, deactivation, "sign out everywhere") invalidates older sessions.
    if (!u || !u.active || Number(payload.v ?? 0) !== u.sessionVersion) return null;
    const sid = String(payload.sid || '');
    if (sid) {
      const s = await db.query.sessions.findFirst({ where: and(eq(schema.sessions.id, sid), isNull(schema.sessions.revokedAt)) });
      if (!s) return null;
      if (Date.now() - +s.lastSeenAt > 5 * 60_000) await db.update(schema.sessions).set({ lastSeenAt: new Date() }).where(eq(schema.sessions.id, sid));
    }
    // Workspace admins always have both modules with full rights.
    const admin = u.role === 'admin'; const deskRole: DeskRole = admin ? 'admin' : u.deskRole;
    const cr = !admin && u.customRoleId ? await db.query.customRoles.findFirst({ where: eq(schema.customRoles.id, u.customRoleId) }) : null;
    const perms = narrowPerms(basePerms(u.role, deskRole), cr?.permissions);
    return { id: u.id, name: u.name, email: u.email, role: u.role, theme: u.theme, crmAccess: admin || u.crmAccess, deskRole, ticketScope: admin ? 'all' : u.ticketScope, sid, perms, customRole: cr?.name || null };
  } catch { return null; }
}
export async function requireUser() { const u = await getUser(); if (!u) redirect('/login'); return u; }
export async function requireAdmin() { const u = await requireUser(); if (u.role !== 'admin') throw new Error('Only admins can change this.'); return u; }
export async function requireManager() { const u = await requireUser(); if (u.role === 'rep') throw new Error('Only managers and admins can do this.'); return u; }
/** Where someone lands after sign-in, based on the modules they can use. */
export const homeFor = (u: Pick<SessionUser, 'crmAccess' | 'deskRole'>) => u.crmAccess ? '/' : u.deskRole !== 'none' ? '/desk' : '/settings?tab=account';
/** CRM pages: people without CRM access go to their own home instead. */
export async function requireCrmPage() { const u = await requireUser(); if (!u.crmAccess) redirect(homeFor(u)); return u; }
export async function requireDeskPage() { const u = await requireUser(); if (u.deskRole === 'none') redirect(homeFor(u)); return u; }
/** Reps may edit only what they own; managers and admins may edit everything. */
export function canEdit(u: SessionUser, ownerId: string | null | undefined) { return u.role !== 'rep' || !ownerId || ownerId === u.id; }
