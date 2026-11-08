import 'server-only';
import { and, eq, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { Deal } from '@/db/schema';
import { getSettings } from './settings';
import { notify } from './notify';
import { addDaysISO, contractEndFrom, todayISO } from './utils';
import { seal } from './crypto-box';

const isRecurring = (billing: string | null | undefined) => !!billing && !/one.?time/i.test(billing);

/** A won deal adds its subscription/licence lines to the customer's licence register (once per deal). */
export async function licencesFromDeal(d: Deal) {
  if (!d.companyId) return 0;
  if ((await db.select({ id: schema.licences.id }).from(schema.licences).where(eq(schema.licences.dealId, d.id)).limit(1)).length) return 0;
  const items = await db.select().from(schema.dealItems).where(eq(schema.dealItems.dealId, d.id)); if (!items.length) return 0;
  const prods = await db.select().from(schema.products).where(inArray(schema.products.id, items.map((i) => i.productId).filter((x): x is string => !!x).concat(['00000000-0000-0000-0000-000000000000'])));
  const start = d.contractStart || todayISO(); const end = d.contractEnd || contractEndFrom(start, d.termMonths || 12);
  // A won renewal replaces the licences it renews: carry the keys forward and mark the old ones renewed.
  const renewed = await db.select().from(schema.licences).where(eq(schema.licences.renewalDealId, d.id));
  const rows = items.filter((i) => { const p = prods.find((x) => x.id === i.productId); return p ? isRecurring(p.billingType) || /licen[cs]e|subscription/i.test(`${p.category} ${p.name}`) : /licen[cs]e|subscription/i.test(i.name); })
    .map((i) => { const p = prods.find((x) => x.id === i.productId); const prev = renewed.find((r) => r.productId && r.productId === i.productId);
      return { companyId: d.companyId!, contactId: d.contactId, productId: i.productId, productName: p?.name || i.name, vendor: p?.category || null, seats: Math.max(1, Math.round(i.qty)),
        licenceKey: prev?.licenceKey || null, startDate: start, endDate: end, value: Math.round(i.qty * i.unitPrice * (1 - i.discountPct / 100) * 100) / 100, currency: d.currency, dealId: d.id, isSample: d.isSample }; });
  if (renewed.length) await db.update(schema.licences).set({ status: 'renewed', updatedAt: new Date() }).where(eq(schema.licences.renewalDealId, d.id));
  if (rows.length) await db.insert(schema.licences).values(rows);
  return rows.length;
}

/** Daily: open one renewal deal per customer and expiry date, N days before licences end; mark lapsed ones expired. */
export async function licenceRenewals(today = todayISO()) {
  const s = await getSettings();
  await db.update(schema.licences).set({ status: 'expired', updatedAt: new Date() }).where(and(eq(schema.licences.status, 'active'), lt(schema.licences.endDate, today)));
  if (!s.licenceRenewalDays) return 0;
  const due = await db.select().from(schema.licences).where(and(eq(schema.licences.status, 'active'), isNull(schema.licences.renewalDealId), lte(schema.licences.endDate, addDaysISO(s.licenceRenewalDays, today)), sql`${schema.licences.endDate} >= ${today}`));
  if (!due.length) return 0;
  // Licences that came from a deal which already has its own renewal (contract-based renewals) just link to it.
  const srcIds = due.map((l) => l.dealId).filter((x): x is string => !!x);
  const src = srcIds.length ? await db.select({ id: schema.deals.id, renewalDealId: schema.deals.renewalDealId }).from(schema.deals).where(inArray(schema.deals.id, srcIds)) : [];
  const pipes = await db.select().from(schema.pipelines);
  const pipe = pipes.find((p) => p.id === s.renewalPipelineId) || pipes.find((p) => p.name.toLowerCase() === 'renewals'); if (!pipe) return 0;
  const sub = (await db.select().from(schema.subPipelines).where(eq(schema.subPipelines.pipelineId, pipe.id)).orderBy(schema.subPipelines.sortOrder))[0]; if (!sub) return 0;
  const first = (await db.select().from(schema.stages).where(and(eq(schema.stages.subPipelineId, sub.id), eq(schema.stages.type, 'open'))).orderBy(schema.stages.sortOrder))[0]; if (!first) return 0;
  const groups = new Map<string, typeof due>();
  for (const l of due) {
    const linked = src.find((d) => d.id === l.dealId)?.renewalDealId;
    if (linked) { await db.update(schema.licences).set({ renewalDealId: linked }).where(eq(schema.licences.id, l.id)); continue; }
    const k = `${l.companyId}|${l.endDate}`; groups.set(k, [...(groups.get(k) || []), l]);
  }
  let made = 0;
  for (const [, ls] of groups) {
    const co = await db.query.companies.findFirst({ where: eq(schema.companies.id, ls[0].companyId) }); if (!co) continue;
    const end = ls[0].endDate!; const start = addDaysISO(1, end);
    const [deal] = await db.insert(schema.deals).values({ name: `${co.name} – licence renewal ${start.slice(0, 4)}`, pipelineId: pipe.id, subPipelineId: sub.id, stageId: first.id,
      amount: Math.round(ls.reduce((a, l) => a + (l.value || 0), 0) * 100) / 100, currency: ls[0].currency, companyId: co.id, contactId: ls[0].contactId, ownerId: co.ownerId, closingDate: end,
      dealType: 'Renewal', contractStart: start, termMonths: 12, contractEnd: contractEndFrom(start, 12), recurringValue: ls.reduce((a, l) => a + (l.value || 0), 0), sourceDealId: ls[0].dealId, isSample: ls.every((l) => l.isSample) }).returning();
    await db.insert(schema.dealItems).values(ls.map((l) => ({ dealId: deal.id, productId: l.productId, name: l.productName, qty: l.seats, unitPrice: l.seats ? Math.round(((l.value || 0) / l.seats) * 100) / 100 : 0 })));
    await db.update(schema.licences).set({ renewalDealId: deal.id, updatedAt: new Date() }).where(inArray(schema.licences.id, ls.map((l) => l.id)));
    await db.insert(schema.dealEvents).values([{ dealId: deal.id, kind: 'created', text: `Renewal opened automatically — ${ls.length} licence${ls.length === 1 ? '' : 's'} end ${end}` }, { dealId: deal.id, kind: 'stage', stageId: first.id }]);
    await db.insert(schema.activities).values({ type: 'task', title: `Send renewal quote: ${co.name}`, dueDate: today, relatedType: 'deal', relatedId: deal.id, ownerId: co.ownerId, automation: 'Licence renewal' });
    await notify([co.ownerId], 'Licence renewal opened', `${co.name}: ${ls.map((l) => `${l.productName} ×${l.seats}`).join(', ')} — ends ${end}`, `/deals/${deal.id}`);
    made++;
  }
  return made;
}
export const sealKey = (k: string | null | undefined) => (k && k.trim() ? seal(k.trim()) : null);
