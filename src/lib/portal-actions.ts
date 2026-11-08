'use server';
import bcrypt from 'bcryptjs';
import { jwtVerify } from 'jose';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { authSecret } from './auth';
import { createPortalSession, getPortalUser, PORTAL_COOKIE, portalCanSee } from './portal-auth';
import { createTicketInternal, customerReplied, defaultStatus, ratingToken, setStatusInternal, event, statuses } from './desk';
import { getSettings } from './settings';
import { rateLimit } from './rate-limit';
import { passwordProblem } from './utils';
import { mailEnabled, sendMail } from './mailer';
import { audit } from './audit';
import { log } from './log';
import { SignJWT } from 'jose';

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (error: string) => ({ ok: false as const, error });
const ip = () => (headers().get('x-forwarded-for') || headers().get('x-real-ip') || 'local').split(',')[0].trim();
const safe = async <T extends object>(fn: () => Promise<R<T>>): Promise<R<T>> => {
  try { return await fn(); } catch (e) { if ((e as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw e; log.error('portal_action_failed', { error: String(e) }); return fail('Something went wrong. Please try again.'); }
};

export async function portalLogin(email: string, password: string): Promise<R> {
  return safe(async () => {
    const e = email.trim().toLowerCase();
    if (!rateLimit(`plogin:${ip()}`, 20, 10 * 60_000) || !rateLimit(`plogin:${e}`, 8, 15 * 60_000)) return fail('Too many attempts. Wait a few minutes and try again.');
    const c = await db.query.contacts.findFirst({ where: sql`lower(${schema.contacts.email}) = ${e}` });
    if (!c || !c.portalEnabled || !c.portalPasswordHash || !(await bcrypt.compare(password, c.portalPasswordHash))) return fail('That email and password don’t match a portal account.');
    await createPortalSession(c); await db.update(schema.contacts).set({ portalLastLogin: new Date() }).where(eq(schema.contacts.id, c.id));
    redirect('/portal/tickets');
  });
}
export async function portalLogout() { cookies().delete(PORTAL_COOKIE); redirect('/portal'); }
export async function portalSetPassword(token: string, password: string): Promise<R> {
  return safe(async () => {
    let id = '', v = -1;
    try { const { payload } = await jwtVerify(token, authSecret()); if (payload.p !== 'portal-invite') throw new Error(); id = String(payload.sub); v = Number(payload.v); } catch { return fail('This link has expired. Ask support for a new one.'); }
    const c = await db.query.contacts.findFirst({ where: eq(schema.contacts.id, id) });
    if (!c || !c.portalEnabled || c.portalVersion !== v) return fail('This link is no longer valid. Ask support for a new one.');
    const p = passwordProblem(password, c.email || undefined); if (p) return fail(p);
    const [row] = await db.update(schema.contacts).set({ portalPasswordHash: await bcrypt.hash(password, 10), portalVersion: c.portalVersion + 1, portalLastLogin: new Date() }).where(eq(schema.contacts.id, c.id)).returning();
    await createPortalSession(row); await audit(null, 'portal.password_set', 'contact', c.id);
    return { ok: true };
  });
}
export async function portalForgot(email: string): Promise<R<{ message: string }>> {
  return safe(async () => {
    if (!rateLimit(`pforgot:${ip()}`, 5, 15 * 60_000)) return fail('Too many requests. Wait a few minutes.');
    const c = await db.query.contacts.findFirst({ where: sql`lower(${schema.contacts.email}) = ${email.trim().toLowerCase()}` });
    if (c?.portalEnabled && c.email && mailEnabled()) {
      const token = await new SignJWT({ sub: c.id, v: c.portalVersion, p: 'portal-invite' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('2h').sign(authSecret());
      const s = await getSettings();
      await sendMail(c.email, `Reset your ${s.portalTitle} password`, `Hello ${c.firstName},\n\nChoose a new password here (valid 2 hours):\n${(process.env.APP_URL || '').replace(/\/$/, '')}/portal/set-password?token=${token}\n\nIf you didn't ask for this, ignore this email.`);
    }
    return { ok: true, message: mailEnabled() ? 'If that email has portal access, a reset link is on its way.' : 'Please contact support to reset your password.' };
  });
}

async function departmentFor(id?: string | null) {
  const deps = await db.select().from(schema.departments).where(eq(schema.departments.active, true));
  return (deps.find((d) => d.id === id) || deps.sort((a, b) => a.sortOrder - b.sortOrder)[0])?.id;
}
/** Signed-in customer opens a request. */
export async function portalCreateTicket(input: { subject: string; description: string; productId?: string; priority?: string; departmentId?: string }): Promise<R<{ id: string }>> {
  return safe(async () => {
    const me = await getPortalUser(); if (!me) return fail('Please sign in again.');
    if (!rateLimit(`pticket:${me.id}`, 15, 60 * 60_000)) return fail('You’ve opened a lot of requests recently. Please wait a little.');
    const subject = input.subject.trim(); const body = input.description.trim();
    if (subject.length < 3) return fail('Add a short subject.'); if (body.length < 5) return fail('Describe the problem.');
    const t = await createTicketInternal({ subject: subject.slice(0, 200), description: body.slice(0, 20000), departmentId: await departmentFor(input.departmentId), channel: 'portal', contactId: me.id, companyId: me.companyId,
      priority: input.priority && ['Low', 'Medium', 'High'].includes(input.priority) ? input.priority : 'Medium', productId: input.productId || null, ack: true,
      firstMessage: { kind: 'incoming', body: body.slice(0, 20000), fromName: [me.firstName, me.lastName].filter(Boolean).join(' '), fromEmail: me.email } });
    revalidatePath('/portal', 'layout'); return { ok: true, id: t.id };
  });
}
/** Anyone can submit the public request form (spam-guarded). */
export async function submitWebForm(input: { name: string; email: string; phone?: string; company?: string; subject: string; description: string; productId?: string; website?: string; startedAt: number }): Promise<R<{ number: string }>> {
  return safe(async () => {
    const s = await getSettings(); if (!s.webFormEnabled) return fail('The request form is switched off. Please email us instead.');
    if (input.website) return { ok: true, number: '' }; // honeypot: pretend success for bots
    if (Date.now() - +input.startedAt < 3000) return fail('That was quick! Please check the form and send again.');
    if (!rateLimit(`webform:${ip()}`, 5, 60 * 60_000)) return fail('Too many requests from your network. Please try again later.');
    const email = input.email.trim().toLowerCase();
    if (!input.name.trim() || !/^\S+@\S+\.\S+$/.test(email)) return fail('Enter your name and a valid email.');
    if (input.subject.trim().length < 3 || input.description.trim().length < 5) return fail('Add a subject and describe the problem.');
    const t = await createTicketInternal({ subject: input.subject.trim().slice(0, 200), description: input.description.trim().slice(0, 20000), departmentId: await departmentFor(null), channel: 'web',
      requesterName: input.name.trim().slice(0, 120), requesterEmail: email, requesterPhone: input.phone?.trim().slice(0, 40) || null, productId: input.productId || null, ack: true,
      custom: input.company ? { company: input.company.trim().slice(0, 120) } : {}, firstMessage: { kind: 'incoming', body: input.description.trim().slice(0, 20000), fromName: input.name.trim(), fromEmail: email } });
    return { ok: true, number: `${s.ticketPrefix}-${1000 + t.number}` };
  });
}
async function myTicket(id: string) {
  const me = await getPortalUser(); if (!me) throw Object.assign(new Error('sign in'), { portal: true });
  const t = /^[0-9a-f-]{36}$/.test(id) ? await db.query.tickets.findFirst({ where: eq(schema.tickets.id, id) }) : undefined;
  if (!t || !portalCanSee(me, t)) return { me, t: null };
  return { me, t };
}
export async function portalReply(id: string, body: string): Promise<R> {
  return safe(async () => {
    const { me, t } = await myTicket(id); if (!t) return fail('This request isn’t available.');
    if (!body.trim()) return fail('Write a message first.');
    if (!rateLimit(`preply:${me.id}`, 40, 60 * 60_000)) return fail('Please wait a little before sending more messages.');
    if (t.mergedIntoId) return fail('This request was merged into another one. Please reply there.');
    await customerReplied(t, body.slice(0, 20000), { fromName: [me.firstName, me.lastName].filter(Boolean).join(' '), fromEmail: me.email, channel: 'portal' });
    revalidatePath(`/portal/tickets/${id}`); return { ok: true };
  });
}
export async function portalResolve(id: string): Promise<R> {
  return safe(async () => {
    const { me, t } = await myTicket(id); if (!t) return fail('This request isn’t available.');
    const st = (await statuses()).find((x) => x.category === 'closed' && !/^closed/i.test(x.name)) || (await defaultStatus('closed'));
    await setStatusInternal(t, st.id, null); await event(t.id, null, `Marked resolved by ${me.firstName} in the portal`);
    revalidatePath(`/portal/tickets/${id}`); return { ok: true };
  });
}
export async function portalRate(id: string, rating: 'good' | 'ok' | 'bad', comment?: string): Promise<R> {
  return safe(async () => {
    const { t } = await myTicket(id); if (!t) return fail('This request isn’t available.');
    return saveRating(t.id, rating, comment);
  });
}
async function saveRating(id: string, rating: string, comment?: string): Promise<R> {
  if (!['good', 'ok', 'bad'].includes(rating)) return fail('Choose a rating.');
  const t = await db.query.tickets.findFirst({ where: eq(schema.tickets.id, id) }); if (!t) return fail('This request isn’t available.');
  if (t.statusCategory !== 'closed') return fail('You can rate a request once it’s resolved.');
  await db.update(schema.tickets).set({ rating, ratingComment: comment?.trim().slice(0, 2000) || t.ratingComment, ratedAt: new Date() }).where(eq(schema.tickets.id, id));
  await event(id, null, `Customer rated: ${rating === 'good' ? 'great' : rating === 'ok' ? 'okay' : 'not good'}${comment ? ` — “${comment.trim().slice(0, 140)}”` : ''}`);
  if (rating === 'bad' && t.assigneeId) { const { notify } = await import('./notify'); const u = await db.query.users.findFirst({ where: eq(schema.users.id, t.assigneeId), columns: { managerId: true } });
    await notify([t.assigneeId, u?.managerId], 'A customer was unhappy with a resolved ticket', comment?.slice(0, 120) || t.subject, `/desk/tickets/${t.id}`); }
  return { ok: true };
}
/** Rating links from the resolution email (no sign-in, signed per ticket). */
export async function rateByToken(id: string, tok: string, rating: string, comment?: string): Promise<R> {
  return safe(async () => {
    if (!/^[0-9a-f-]{36}$/.test(id) || tok !== ratingToken(id)) return fail('This rating link isn’t valid.');
    if (!rateLimit(`rate:${ip()}`, 30, 60 * 60_000)) return fail('Too many requests.');
    return saveRating(id, rating, comment);
  });
}
export async function kbVote(slug: string, helpful: boolean): Promise<R> {
  return safe(async () => {
    if (!rateLimit(`kbvote:${ip()}:${slug}`, 1, 24 * 3600_000)) return { ok: true };
    await db.update(schema.kbArticles).set(helpful ? { helpful: sql`${schema.kbArticles.helpful} + 1` } : { notHelpful: sql`${schema.kbArticles.notHelpful} + 1` }).where(eq(schema.kbArticles.slug, slug));
    return { ok: true };
  });
}

/* ---------------- customer community ---------------- */
export async function forumCreateTopic(input: { category: string; title: string; body: string }): Promise<R<{ id: string }>> {
  return safe(async () => {
    const s = await getSettings(); if (!s.communityEnabled) return fail('The community is closed.');
    const me = await getPortalUser(); if (!me) return fail('Sign in to post in the community.');
    if (!rateLimit(`forum:${me.id}`, 10, 60 * 60_000)) return fail('You’ve posted a lot in the last hour. Please wait a little.');
    const title = input.title.trim(); const body = input.body.trim();
    if (title.length < 8) return fail('Give your question a title of at least a few words.');
    if (body.length < 10) return fail('Describe your question in a sentence or two.');
    const [row] = await db.insert(schema.forumTopics).values({ category: s.forumCategories.includes(input.category) ? input.category : s.forumCategories[0] || 'General', title: title.slice(0, 200), body: body.slice(0, 10000), contactId: me.id, authorName: `${me.firstName}${me.lastName ? ' ' + me.lastName[0] + '.' : ''}` }).returning();
    revalidatePath('/portal/community'); return { ok: true as const, id: row.id };
  });
}
export async function forumReply(topicId: string, body: string): Promise<R> {
  return safe(async () => {
    const me = await getPortalUser(); if (!me) return fail('Sign in to reply.');
    const t = await db.query.forumTopics.findFirst({ where: eq(schema.forumTopics.id, topicId) }); if (!t || t.hidden) return fail('This topic no longer exists.');
    if (t.locked) return fail('This topic is locked.');
    if (!rateLimit(`forum:${me.id}`, 30, 60 * 60_000)) return fail('You’ve posted a lot in the last hour. Please wait a little.');
    if (body.trim().length < 2) return fail('Write a reply.');
    await db.insert(schema.forumPosts).values({ topicId, body: body.trim().slice(0, 10000), contactId: me.id, authorName: `${me.firstName}${me.lastName ? ' ' + me.lastName[0] + '.' : ''}` });
    await db.update(schema.forumTopics).set({ lastPostAt: new Date() }).where(eq(schema.forumTopics.id, topicId));
    revalidatePath(`/portal/community/${topicId}`); return { ok: true as const };
  });
}
/** The person who asked marks the reply that solved it. */
export async function forumMarkAnswer(topicId: string, postId: string | null): Promise<R> {
  return safe(async () => {
    const me = await getPortalUser(); if (!me) return fail('Sign in first.');
    const t = await db.query.forumTopics.findFirst({ where: eq(schema.forumTopics.id, topicId) }); if (!t || t.contactId !== me.id) return fail('Only the person who asked can mark the answer.');
    if (postId) { const p = await db.query.forumPosts.findFirst({ where: eq(schema.forumPosts.id, postId) }); if (!p || p.topicId !== topicId) return fail('That reply isn’t in this topic.'); }
    await db.update(schema.forumTopics).set({ answerId: postId }).where(eq(schema.forumTopics.id, topicId)); revalidatePath(`/portal/community/${topicId}`); return { ok: true as const };
  });
}
