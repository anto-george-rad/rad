import { db, schema } from '@/db';
import { getUser } from '@/lib/auth';
import { taskScope, visibleTasks } from '@/lib/visibility';
import { getPipelineTree, getUsers } from '@/lib/data';
import { fullName } from '@/lib/utils';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';
// Quote cells, and neutralise anything a spreadsheet would run as a formula.
const q = (v: unknown) => { let s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export async function GET(_: Request, { params }: { params: { entity: string } }) {
  const me = await getUser(); if (!me) return new Response('Sign in first', { status: 401 });
  if (params.entity === 'tickets') return exportTickets(me);
  if (!me.perms.exportData) return new Response('Your role doesn’t allow exporting data.', { status: 403 });
  if (!me.crmAccess) return new Response('You don’t have access to the CRM.', { status: 403 });
  const scope = await taskScope(me);
  const [users, pipes, companies, contacts, products] = await Promise.all([getUsers(), getPipelineTree(), db.select().from(schema.companies), db.select().from(schema.contacts), db.select().from(schema.products)]);
  const who = (id: string | null) => users.find((u) => u.id === id)?.name || '';
  const stage = (id: string) => { for (const p of pipes) for (const s of p.subs) { const x = s.stages.find((y) => y.id === id); if (x) return { p: p.name, s: x.name }; } return { p: '', s: '' }; };
  const co = (id: string | null) => companies.find((c) => c.id === id)?.name || '';
  const prod = (ids: string[]) => ids.map((i) => products.find((p) => p.id === i)?.name).filter(Boolean).join('; ');
  let rows: unknown[][];
  switch (params.entity) {
    case 'deals': rows = [['Name', 'Pipeline', 'Stage', 'Amount', 'Currency', 'AED at close', 'Deal type', 'Lead source', 'Company', 'Contact', 'Closing date', 'Next step', 'Priority', 'Owner', 'Contract start', 'Contract end', 'Term months', 'Recurring value', 'Tender no.', 'Submission deadline', 'PO number', 'Payment terms', 'Win reason', 'Loss reason', 'Competitor', 'Tags', 'Created'],
      ...(await db.select().from(schema.deals)).map((d) => [d.name, stage(d.stageId).p, stage(d.stageId).s, d.amount, d.currency, d.amountBase, d.dealType, d.leadSource, co(d.companyId), fullName(contacts.find((c) => c.id === d.contactId)), d.closingDate, d.nextStep, d.priority, who(d.ownerId),
        d.contractStart, d.contractEnd, d.termMonths, d.recurringValue, d.tenderNumber, d.submissionDeadline, d.poNumber, d.paymentTerms, d.winReason, d.lossReason, d.competitor, d.tags.join('; '), d.createdAt])]; break;
    case 'leads': rows = [['First name', 'Last name', 'Company', 'Job title', 'Email', 'Phone', 'Source', 'Campaign', 'Status', 'Disqualification reason', 'Industry', 'Emirate', 'Website', 'Company size', 'Budget', 'Timeline', 'Product of interest', 'Consent', 'Do not contact', 'First contacted', 'Owner', 'Tags', 'Created'],
      ...(await db.select().from(schema.leads)).map((l) => [l.firstName, l.lastName, l.companyName, l.jobTitle, l.email, l.phone, l.source, l.campaign, l.status, l.disqualReason, l.industry, l.emirate, l.website, l.companySize, l.budget, l.timeline, prod(l.productInterestId ? [l.productInterestId] : []), l.consent, l.doNotContact, l.firstContactedAt, who(l.ownerId), l.tags.join('; '), l.createdAt])]; break;
    case 'contacts': rows = [['First name', 'Last name', 'Job title', 'Department', 'Buying role', 'Company', 'Email', 'Office phone', 'Mobile', 'WhatsApp', 'LinkedIn', 'Language', 'Products handled', 'Consent', 'Do not contact', 'Last contacted', 'Source', 'Owner', 'Tags'],
      ...contacts.map((c) => [c.firstName, c.lastName, c.jobTitle, c.department, c.buyingRole, co(c.companyId), c.email, c.phone, c.mobile, c.whatsapp, c.linkedin, c.language, prod(c.productIds), c.consent, c.doNotContact, c.lastContactedAt, c.source, who(c.ownerId), c.tags.join('; ')])]; break;
    case 'companies': rows = [['Name', 'Account type', 'Tier', 'Industry', 'Sector', 'Emirate', 'Zone', 'Website', 'Phone', 'City', 'Country', 'VAT TRN', 'Trade licence no.', 'Licence expiry', 'Employees', 'Annual revenue', 'Customer since', 'Owner'],
      ...companies.map((c) => [c.name, c.accountType, c.tier, c.industry, c.sector, c.emirate, c.zone, c.website, c.phone, c.city, c.country, c.vatTrn, c.tradeLicenceNo, c.tradeLicenceExpiry, c.employees, c.annualRevenue, c.customerSince, who(c.ownerId)])]; break;
    case 'activities': rows = [['Title', 'Type', 'Due date', 'Time', 'Done', 'Outcome', 'Duration (min)', 'Location', 'Related type', 'Owner'], ...visibleTasks(await db.select().from(schema.activities), scope).map((a) => [a.title, a.type, a.dueDate, a.dueTime, a.done, a.outcome, a.durationMin, a.location, a.relatedType, who(a.ownerId)])]; break;
    case 'products': rows = [['Name', 'SKU', 'Category', 'Billing', 'Unit', 'Unit price AED', 'Cost price AED', 'Active'], ...products.map((p) => [p.name, p.sku, p.category, p.billingType, p.unit, p.unitPrice, me.perms.viewCost ? p.costPrice : '', p.active])]; break;
    default: return new Response('Unknown export', { status: 404 });
  }
  await audit(me.id, 'data.exported', params.entity, null, `${rows.length - 1} rows`);
  const csv = '﻿' + rows.map((r) => r.map(q).join(',')).join('\n');
  return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="raidefend-${params.entity}-${new Date().toISOString().slice(0, 10)}.csv"` } });
}

async function exportTickets(me: NonNullable<Awaited<ReturnType<typeof getUser>>>) {
  if (!me.perms.exportData && me.deskRole !== 'admin') return new Response('Your role doesn’t allow exporting data.', { status: 403 });
  if (!(me.deskRole === 'admin' || (me.deskRole === 'agent' && me.role !== 'rep'))) return new Response('Only helpdesk admins and managers can export tickets.', { status: 403 });
  const { deskCtx, ticketWhere } = await import('@/lib/desk-access'); const { getSettings } = await import('@/lib/settings'); const { ticketTag } = await import('@/lib/mail-parse');
  const c = await deskCtx(me); const s = await getSettings();
  const [rows, users, deps, sts] = await Promise.all([db.select().from(schema.tickets).where(ticketWhere(c)), getUsers(), db.select().from(schema.departments), db.select().from(schema.ticketStatuses)]);
  const who = (id: string | null) => users.find((u) => u.id === id)?.name || '';
  const data = [['Ticket', 'Subject', 'Status', 'Priority', 'Department', 'Assignee', 'Channel', 'Type', 'Category', 'Requester', 'Email', 'Created', 'First response', 'Resolved', 'Due', 'SLA breached', 'Rating', 'Tags'],
    ...rows.map((t) => [ticketTag(s.ticketPrefix, t.number), t.subject, sts.find((x) => x.id === t.statusId)?.name, t.priority, deps.find((d) => d.id === t.departmentId)?.name, who(t.assigneeId), t.channel, t.type, t.category, t.requesterName, t.requesterEmail,
      t.createdAt, t.firstRespondedAt, t.resolvedAt, t.dueAt, t.breachedAt || t.frBreachedAt ? 'Yes' : 'No', t.rating, t.tags.join('; ')])];
  await audit(me.id, 'data.exported', 'tickets', null, `${rows.length} rows`);
  return new Response('\ufeff' + data.map((r) => r.map(q).join(',')).join('\n'), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="rad-tickets-${new Date().toISOString().slice(0, 10)}.csv"` } });
}
