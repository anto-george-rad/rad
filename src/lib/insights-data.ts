import 'server-only';
import { db, schema } from '@/db';
import { getPipelineTree, getScoringRules, getUsers } from './data';
import { getSettings } from './settings';
import { toBase } from './settings-defaults';
import { scoreBand, scoreLead } from './scoring';
import { fullName, todayISO } from './utils';
import { and, eq, type SQL } from 'drizzle-orm';
import { businessMinutesBetween } from './sla';

export type TicketDS = Awaited<ReturnType<typeof ticketRows>>[number];
/** Ticket rows for reports. `where` is the viewer's ticket visibility (undefined = all). */
export async function ticketRows(where: SQL | undefined) {
  const [rows, sts, deps, users, cos, prods, s] = await Promise.all([db.select().from(schema.tickets).where(and(where, eq(schema.tickets.isSpam, false))), db.select().from(schema.ticketStatuses), db.select().from(schema.departments),
    getUsers(), db.select({ id: schema.companies.id, name: schema.companies.name }).from(schema.companies), db.select({ id: schema.products.id, name: schema.products.name }).from(schema.products), getSettings()]);
  const tz = process.env.APP_TIMEZONE || 'Asia/Dubai';
  return rows.filter((t) => !t.mergedIntoId).map((t) => ({
    id: t.id, ownerId: t.assigneeId, status: t.statusCategory === 'closed' ? 'Closed' : t.statusCategory === 'onhold' ? 'On hold' : 'Open', statusName: sts.find((x) => x.id === t.statusId)?.name || '—',
    priority: t.priority, channel: t.channel, department: deps.find((d) => d.id === t.departmentId)?.name || '—', assignee: users.find((u) => u.id === t.assigneeId)?.name || 'Unassigned',
    type: t.type || 'Not set', category: t.category || 'Not set', company: cos.find((c) => c.id === t.companyId)?.name || 'No company', product: prods.find((x) => x.id === t.productId)?.name || 'No product',
    sla: t.breachedAt || t.frBreachedAt ? 'Missed' : t.statusCategory === 'closed' && t.dueAt ? 'Met' : 'In progress', rating: t.rating === 'good' ? 'Great' : t.rating === 'ok' ? 'Okay' : t.rating === 'bad' ? 'Not good' : 'Not rated',
    firstResponseHrs: t.firstRespondedAt ? businessMinutesBetween(t.createdAt, t.firstRespondedAt, s.businessHours, tz) / 60 : null,
    resolutionHrs: t.resolvedAt ? businessMinutesBetween(t.createdAt, t.resolvedAt, s.businessHours, tz) / 60 : null,
    tags: t.tags, createdAt: +t.createdAt, resolvedAt: t.resolvedAt ? +t.resolvedAt : null,
  }));
}

/** Flat, pre-joined rows the Insights engine aggregates in the browser. */
export type DS = Awaited<ReturnType<typeof buildDataset>>;
/** deskWhere: false = no helpdesk access (no ticket rows); undefined = every ticket; SQL = the viewer's visible tickets. */
export async function buildDataset(scope: Set<string> | null = null, deskWhere: SQL | undefined | false = false) {
  const [pipes, users, s, rules, deals, leads, acts, contacts, companies] = await Promise.all([
    getPipelineTree(), getUsers(), getSettings(), getScoringRules(),
    db.select().from(schema.deals), db.select().from(schema.leads), db.select().from(schema.activities), db.select().from(schema.contacts), db.select().from(schema.companies),
  ]);
  const uname = (id?: string | null) => users.find((u) => u.id === id)?.name || 'Unassigned';
  const stage = new Map<string, { name: string; type: string; prob: number; order: number; pipeline: string }>();
  pipes.forEach((p, pi) => p.subs.forEach((sb) => sb.stages.forEach((st, i) => stage.set(st.id, { name: st.name, type: st.type, prob: st.probability ?? 0, order: pi * 100 + i, pipeline: p.name }))));
  const co = new Map(companies.map((c) => [c.id, c]));
  const t = todayISO();
  const stageOrder: Record<string, number> = {};
  stage.forEach((v) => { stageOrder[v.name] = Math.min(stageOrder[v.name] ?? 9999, v.order); });
  return {
    stageOrder,
    deals: deals.map((d) => {
      const st = stage.get(d.stageId); const status = st?.type === 'won' ? 'Won' : st?.type === 'lost' ? 'Lost' : 'Open';
      const amt = d.amountBase ?? toBase(d.amount, d.currency, s);
      return { id: d.id, ownerId: d.ownerId, pipelineId: d.pipelineId, status, stage: st?.name || '—', pipeline: st?.pipeline || '—', owner: uname(d.ownerId), priority: d.priority,
        company: co.get(d.companyId || '')?.name || 'No company', industry: co.get(d.companyId || '')?.industry || 'Unknown', tags: d.tags, lossReason: d.lossReason, winReason: d.winReason, currency: d.currency, dealType: d.dealType, leadSource: d.leadSource || 'Unknown',
        emirate: co.get(d.companyId || '')?.emirate || 'Unknown', accountType: co.get(d.companyId || '')?.accountType || 'No company',
        distributor: co.get(d.distributorId || '')?.name || 'Direct', reseller: co.get(d.resellerId || '')?.name || 'None', forecast: d.forecastCategory,
        amount: amt, weighted: status === 'Open' ? amt * (st?.prob || 0) / 100 : 0,
        createdAt: +d.createdAt, closedAt: d.closedAt ? +d.closedAt : null, closingDate: d.closingDate ? +new Date(d.closingDate + 'T00:00:00') : null };
    }),
    leads: leads.map((l) => { const sc = scoreLead(l, rules).score; return { id: l.id, ownerId: l.ownerId, status: l.status, source: l.source || 'Unknown', campaign: l.campaign || 'None', emirate: l.emirate || 'Unknown', disqualReason: l.disqualReason, firstContactDays: l.firstContactedAt ? Math.max(0, (+l.firstContactedAt - +l.createdAt) / 86_400_000) : null, score: sc, band: scoreBand(sc, s.hotScore, s.warmScore), owner: uname(l.ownerId), company: l.companyName || 'No company', tags: l.tags, createdAt: +l.createdAt }; }),
    activities: acts.filter((a) => !scope || !a.ownerId || scope.has(a.ownerId)).map((a) => ({ id: a.id, ownerId: a.ownerId, type: { task: 'Task', call: 'Call', meeting: 'Meeting', email: 'Email', whatsapp: 'WhatsApp' }[a.type], status: a.done ? 'Done' : a.dueDate && a.dueDate < t ? 'Overdue' : 'Open',
      owner: uname(a.ownerId), related: ({ deal: 'Deal', lead: 'Lead', contact: 'Contact', company: 'Company' } as Record<string, string>)[a.relatedType || ''] || 'Nothing', outcome: a.outcome || 'Not recorded',
      due: a.dueDate ? +new Date(a.dueDate + 'T00:00:00') : null, createdAt: +a.createdAt })),
    contacts: contacts.map((c) => ({ id: c.id, ownerId: c.ownerId, name: fullName(c), company: co.get(c.companyId || '')?.name || 'No company', source: c.source || 'Unknown', owner: uname(c.ownerId), tags: c.tags, createdAt: +c.createdAt })),
    companies: companies.map((c) => {
      const ds = deals.filter((d) => d.companyId === c.id);
      const open = ds.filter((d) => stage.get(d.stageId)?.type === 'open').reduce((x, d) => x + toBase(d.amount, d.currency, s), 0);
      const won = ds.filter((d) => stage.get(d.stageId)?.type === 'won').reduce((x, d) => x + (d.amountBase ?? toBase(d.amount, d.currency, s)), 0);
      return { id: c.id, ownerId: c.ownerId, name: c.name, industry: c.industry || 'Unknown', accountType: c.accountType, emirate: c.emirate || 'Unknown', tier: c.tier || 'None', city: c.city || 'Unknown', country: c.country || 'Unknown', openValue: open, wonValue: won, createdAt: +c.createdAt };
    }),
    pipelines: pipes.map((p) => ({ id: p.id, name: p.name })),
    tickets: deskWhere === false ? [] as TicketDS[] : await ticketRows(deskWhere),
  };
}
