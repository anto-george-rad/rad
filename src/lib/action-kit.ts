import 'server-only';
import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { Ticket } from '@/db/schema';
import { requireUser, type SessionUser } from './auth';
import { canManageDesk, canSeeTicket, canWorkTicket, deskCtx, type DeskCtx } from './desk-access';
import { log } from './log';

/** Shared plumbing for server actions: results, readable errors, and module guards. */
export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
export const fail = (error: string) => ({ ok: false as const, error });
export const done = <T extends object>(x?: T) => { revalidatePath('/', 'layout'); return { ok: true as const, ...(x || ({} as T)) }; };
export class UserError extends Error {}
export const clean = (v: unknown) => { const s = typeof v === 'string' ? v.trim() : v; return s === '' || s === undefined ? null : s; };
export const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v);
const readable = /^(Only |You |This |That |Set up |Choose |Give |Enter |Add |Use |Pick |Name |Type |Write |The |A |An |Your |Microsoft |WhatsApp |No |Nothing )/;
async function run<T extends object>(kind: string, fn: () => Promise<Result<T>>, uid?: string): Promise<Result<T>> {
  try { return await fn(); } catch (e) {
    if ((e as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw e;
    const msg = (e as Error)?.message || '';
    if (e instanceof UserError || readable.test(msg)) return fail(msg);
    log.error(`${kind}_action_failed`, { user: uid, error: msg, stack: (e as Error)?.stack?.split('\n').slice(0, 4).join(' | ') });
    return fail('Something went wrong. The error has been logged; try again or tell your admin.');
  }
}
/** CRM actions: signed in with CRM access. */
export async function crmAct<T extends object>(fn: (me: SessionUser) => Promise<Result<T>>) {
  const me = await requireUser(); if (!me.crmAccess) return fail('You don’t have access to the CRM.');
  return run('crm', () => fn(me), me.id);
}
/** Helpdesk actions: signed in with a helpdesk role, plus the permission context. */
export async function deskAct<T extends object>(fn: (me: SessionUser, c: DeskCtx) => Promise<Result<T>>) {
  const me = await requireUser(); if (me.deskRole === 'none') return fail('You don’t have access to the helpdesk.');
  return run('desk', async () => fn(me, await deskCtx(me)), me.id);
}
export const deskAdminOnly = (c: DeskCtx) => { if (!canManageDesk(c)) throw new UserError('Only helpdesk admins can change this.'); };
export const adminOnly = (me: SessionUser) => { if (me.role !== 'admin') throw new UserError('Only admins can change this.'); };
export const managerOnly = (me: SessionUser) => { if (me.role === 'rep') throw new UserError('Only managers and admins can do this.'); };
export async function ticketFor(c: DeskCtx, id: string, need: 'see' | 'work'): Promise<Ticket> {
  const t = isUuid(id) ? await db.query.tickets.findFirst({ where: eq(schema.tickets.id, id) }) : undefined;
  if (!t || !canSeeTicket(c, t)) throw new UserError('This ticket doesn’t exist or you can’t open it.');
  if (need === 'work' && !canWorkTicket(c, t)) throw new UserError(c.role === 'light' ? 'Light agents can read tickets and add private notes only.' : 'You can’t change this ticket.');
  return t;
}
