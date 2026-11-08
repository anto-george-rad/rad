import 'server-only';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { Contact, Ticket } from '@/db/schema';
import { authSecret } from './auth';

/** Customer portal sessions are separate from staff sessions (own cookie, contacts not users). */
export const PORTAL_COOKIE = 'rad_portal';
export async function createPortalSession(c: Contact) {
  const token = await new SignJWT({ sub: c.id, v: c.portalVersion, p: 'portal' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('30d').sign(authSecret());
  cookies().set(PORTAL_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' && process.env.INSECURE_COOKIES !== 'true', path: '/', maxAge: 60 * 60 * 24 * 30 });
}
export async function getPortalUser(): Promise<Contact | null> {
  const token = cookies().get(PORTAL_COOKIE)?.value; if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, authSecret()); if (payload.p !== 'portal') return null;
    const c = await db.query.contacts.findFirst({ where: and(eq(schema.contacts.id, String(payload.sub)), eq(schema.contacts.portalEnabled, true)) });
    return c && c.portalVersion === Number(payload.v ?? -1) ? c : null;
  } catch { return null; }
}
export async function requirePortalUser() { const c = await getPortalUser(); if (!c) redirect('/portal/login'); return c; }
/** A customer sees their own tickets, or all of their company's when given company access. Never spam. */
export const portalCanSee = (c: Contact, t: Pick<Ticket, 'contactId' | 'companyId' | 'isSpam'>) => !t.isSpam && (t.contactId === c.id || (c.portalCompanyAccess && !!c.companyId && t.companyId === c.companyId));
