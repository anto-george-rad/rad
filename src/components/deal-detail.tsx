'use client';
import { EmailsPanel, type EmailRow } from './customer-360';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, CalendarClock, Copy, Mail, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import type { Activity, Attachment, Company, Contact, Deal, DealEvent, DealItem, Note } from '@/db/schema';
import type { PipelineTreeT } from '@/lib/types';
import { Button, Chip, ConfirmButton, Field, IconButton, Input, Modal, Panel, Select, useToast } from './ui';
import { useApp, useUserName } from './app-context';
import { useForms } from './forms';
import { ActivityPanel, AttachmentsPanel, DetailGrid, EmailComposer, FavoriteStar, NotesPanel, Owner, rememberRecent, useCustomItems } from './records';
import { useStageMover } from './deals';
import * as A from '@/lib/actions';
import { RecordPicker } from './record-picker';
import { DEAL_CONTACT_ROLES } from '@/lib/options';
import { cn, DAY, daysBetweenISO, fmtDate, fmtMoney, fmtShort, fullName, timeAgo, todayISO } from '@/lib/utils';

type Sub = PipelineTreeT['subs'][number];
type Link_ = { id: string; name: string } | null;
type Partner = { id: string; name: string; accountType: string } | null;
type Person = { id: string; role: string | null; contactId: string; firstName: string; lastName: string | null; jobTitle: string | null; email: string | null };
type Handler = { id: string; firstName: string; lastName: string | null; productIds: string[]; email: string | null; mobile: string | null };
export default function DealDetail({ deal, pipe, sub, company, contact, items, acts, notes, events, rate, source, renewal, files, fav, distributor, reseller, people, costs, handlers, minMargin, emails }: {
  deal: Deal; pipe: PipelineTreeT; sub: Sub; company: Company | null; contact: Contact | null; items: DealItem[]; acts: Activity[]; notes: Note[]; events: DealEvent[]; rate: number; source: Link_; renewal: Link_; files: Attachment[]; fav: boolean;
  distributor: Partner; reseller: Partner; people: Person[]; costs: Record<string, number | null>; handlers: Handler[]; minMargin: number; emails: EmailRow[];
}) {
  const openForm = useForms(); const toast = useToast(); const router = useRouter(); const custom = useCustomItems(); const who = useUserName(); const { aiEnabled } = useApp();
  const { start, dialog } = useStageMover();
  const [email, setEmail] = useState(false); const [addItem, setAddItem] = useState(false); const [cloning, setCloning] = useState(false);
  useEffect(() => { rememberRecent({ type: 'deal', id: deal.id, label: deal.name, href: `/deals/${deal.id}` }); }, [deal.id, deal.name]);
  const today = todayISO(); const tenderLeft = deal.submissionDeadline ? daysBetweenISO(today, deal.submissionDeadline) : null;
  const L = (x: Link_) => x ? <Link className="text-accent hover:underline" href={`/deals/${x.id}`}>{x.name}</Link> : null;
  const [ai, setAi] = useState<{ busy: boolean; text: string }>({ busy: false, text: '' });
  const st = sub.stages.find((s) => s.id === deal.stageId); const ci = sub.stages.findIndex((s) => s.id === deal.stageId);
  const idle = Math.floor((Date.now() - +new Date(deal.stageEnteredAt)) / DAY);
  const line = (i: DealItem) => i.qty * i.unitPrice * (1 - i.discountPct / 100); const itemsTotal = items.reduce((s, i) => s + line(i), 0);
  // Margin: cost prices are in AED; line totals are in the deal currency.
  const costed = items.filter((i) => i.productId && costs[i.productId] != null);
  const cost = costed.reduce((s, i) => s + i.qty * (costs[i.productId!]! / rate), 0); const rev = costed.reduce((s, i) => s + line(i), 0);
  const margin = costed.length && rev > 0 ? Math.round((1 - cost / rev) * 100) : null;
  const { products } = useApp(); const pname = (id: string) => products.find((p) => p.id === id)?.name;
  const runAi = async (k: 'brief' | 'risk') => { setAi({ busy: true, text: '' }); const r = await A.aiDeal(deal.id, k); setAi({ busy: false, text: r.ok ? r.text : r.error }); };
  return <div className="flex flex-col gap-4">
    <Link href={`/deals?p=${pipe.id}&s=${sub.id}`} className="inline-flex w-max items-center gap-1.5 text-[13px] font-semibold text-muted hover:text-ink"><ArrowLeft size={15} />{pipe.name}</Link>
    <div className="flex flex-wrap items-start gap-4">
      <div className="min-w-0 flex-1">
        <p className="eyebrow">{pipe.recordName} · {pipe.name}{pipe.subs.length > 1 && ` · ${sub.name}`}</p>
        <h1 className="font-display text-[30px] font-bold leading-tight tracking-tight">{deal.name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="num font-display text-2xl font-bold" style={{ fontFamily: '"Manrope Variable","Manrope",sans-serif' }}>{fmtMoney(deal.amount, deal.currency)}</span>
          {deal.currency !== 'AED' && deal.amount != null && <span className="text-[13px] text-muted">≈ {fmtMoney(deal.amount * rate)}</span>}
          <Chip tone={st?.type === 'won' ? 'good' : st?.type === 'lost' ? 'bad' : 'accent'}>{st?.name}</Chip>
          <Chip tone={st?.type === 'open' && st.idleDays && idle > st.idleDays ? 'warn' : 'neutral'}>{idle} days in stage</Chip>
          {deal.priority === 'High' && <Chip tone="bad">High priority</Chip>}
          {deal.lossReason && <Chip tone="bad">Lost: {deal.lossReason}{deal.competitor ? ` to ${deal.competitor}` : ''}</Chip>}
          {deal.winReason && <Chip tone="good">Won: {deal.winReason}</Chip>}
          {deal.dealType !== 'New business' && <Chip tone="accent">{deal.dealType}</Chip>}
          {st?.type === 'open' && deal.forecastCategory !== 'Pipeline' && <Chip tone={deal.forecastCategory === 'Commit' ? 'good' : 'accent'}>{deal.forecastCategory}</Chip>}
          {st?.type === 'open' && deal.dealRegExpiry && daysBetweenISO(today, deal.dealRegExpiry) <= 14 && <Chip tone={deal.dealRegExpiry < today ? 'bad' : 'warn'}>{deal.dealRegExpiry < today ? 'Registration expired' : `Registration ends ${fmtDate(deal.dealRegExpiry)}`}</Chip>}
          {st?.type === 'open' && tenderLeft != null && <Chip tone={tenderLeft < 0 ? 'bad' : tenderLeft <= 7 ? 'warn' : 'neutral'}><CalendarClock size={12} />{tenderLeft < 0 ? 'Tender deadline passed' : tenderLeft === 0 ? 'Tender due today' : `Tender due in ${tenderLeft} day${tenderLeft === 1 ? '' : 's'}`}</Chip>}
          {deal.tags.map((t) => <Chip key={t} tone="outline">{t}</Chip>)}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <FavoriteStar type="deal" id={deal.id} label={deal.name} on={fav} />
        <Button onClick={() => setEmail(true)}><Mail size={15} />Email</Button>
        <Button disabled={cloning} onClick={async () => { setCloning(true); const r = await A.cloneDeal(deal.id); setCloning(false); if (!r.ok) toast(r.error, 'bad'); else { toast('Copy created'); router.push(`/deals/${r.id}`); } }}><Copy size={15} />Clone</Button>
        <Button onClick={() => openForm('deal', deal as never)}><Pencil size={15} />Edit</Button>
        <ConfirmButton confirmText="Delete deal?" onConfirm={async () => { const r = await A.deleteRecords('deal', [deal.id]); if (!r.ok) toast(r.error, 'bad'); else { toast('Deal deleted'); router.push(`/deals?p=${pipe.id}`); } }}>Delete</ConfirmButton>
      </div>
    </div>
    {/* stage bar */}
    <div className="flex gap-[3px] overflow-x-auto pb-1">
      {sub.stages.map((s, i) => { const cur = s.id === deal.stageId; const past = i < ci && s.type === 'open';
        return <button key={s.id} onClick={() => !cur && start(deal, s.id)} title={cur ? 'Current stage' : `Move to ${s.name}`}
          style={{ clipPath: i === 0 ? 'polygon(0 0,calc(100% - 9px) 0,100% 50%,calc(100% - 9px) 100%,0 100%)' : 'polygon(0 0,calc(100% - 9px) 0,100% 50%,calc(100% - 9px) 100%,0 100%,9px 50%)' }}
          className={cn('min-w-[110px] flex-1 whitespace-nowrap py-2.5 pl-5 pr-4 text-[12.5px] font-semibold transition first:rounded-l-xl first:pl-4',
            cur ? (s.type === 'won' ? 'bg-good text-white' : s.type === 'lost' ? 'bg-bad text-white' : 'bg-accent text-accent-ink') : past ? 'bg-accent-soft text-accent hover:brightness-95' : 'bg-sunken text-muted hover:text-ink')}>{s.name}</button>; })}
    </div>
    <div className="grid gap-4 xl:grid-cols-[1.45fr_1fr]">
      <div className="flex min-w-0 flex-col gap-4">
        {deal.nextStep && st?.type === 'open' && <div className="rounded-2xl border border-accent/30 bg-accent-soft px-5 py-3.5 text-[13.5px]"><span className="eyebrow !text-accent">Next step</span><div className="mt-0.5 font-medium">{deal.nextStep}</div></div>}
        <Panel title="Details"><DetailGrid items={[
          ['Company', company ? <Link className="font-medium text-accent hover:underline" href={`/companies/${company.id}`}>{company.name}</Link> : null],
          ['Contact', contact ? <Link className="font-medium text-accent hover:underline" href={`/contacts/${contact.id}`}>{fullName(contact)}</Link> : null],
          ['Weighted value', st?.type === 'open' ? fmtMoney((deal.amount || 0) * rate * (st.probability || 0) / 100) : null],
          ['Closing date', fmtDate(deal.closingDate)], ['Owner', <Owner key="o" id={deal.ownerId} />],
          ['Deal type', deal.dealType], ['Lead source', deal.leadSource], ['Forecast category', deal.forecastCategory],
          ...(distributor ? [['Distributor', <Link key="di" className="text-accent hover:underline" href={`/companies/${distributor.id}`}>{distributor.name}</Link>] as [string, React.ReactNode]] : []),
          ...(reseller ? [['Reseller', <Link key="re" className="text-accent hover:underline" href={`/companies/${reseller.id}`}>{reseller.name}</Link>] as [string, React.ReactNode]] : []),
          ...(deal.dealRegNumber || deal.dealRegExpiry ? [['Deal registration', `${deal.dealRegNumber || '—'}${deal.dealRegExpiry ? ` · until ${fmtDate(deal.dealRegExpiry)}` : ''}`] as [string, React.ReactNode]] : []),
          ...(deal.closedAt && deal.amountBase != null ? [['Value at close', fmtMoney(deal.amountBase)] as [string, React.ReactNode]] : []),
          ['Created', fmtDate(deal.createdAt)],
          ...(source ? [['Started from', L(source)] as [string, React.ReactNode]] : []),
          ...(renewal ? [['Renewal', L(renewal)] as [string, React.ReactNode]] : []),
          ...custom('deal', deal.custom, deal.pipelineId),
          ...(deal.description ? [['Description', <span key="d" className="whitespace-pre-wrap">{deal.description}</span>] as [string, React.ReactNode]] : []),
        ]} /></Panel>
        <Panel title="Products" count={items.length} actions={<>{items.length > 0 && Math.round(deal.amount || 0) !== Math.round(itemsTotal) && <Button size="sm" variant="ghost" onClick={async () => { const r = await A.setAmountFromItems(deal.id); if (!r.ok) toast(r.error, 'bad'); else { toast('Amount updated'); router.refresh(); } }}>Set amount to {fmtShort(itemsTotal)}</Button>}<Button size="sm" variant="soft" onClick={() => setAddItem(true)}><Plus size={14} />Add</Button></>}>
          {items.length ? <div className="overflow-x-auto"><table className="tbl"><thead><tr><th>Product</th><th className="text-right">Qty</th><th className="text-right">Unit</th><th className="text-right">Disc.</th><th className="text-right">Total</th><th /></tr></thead>
            <tbody>{items.map((i) => <tr key={i.id}><td className="font-medium">{i.name}</td><td className="num text-right">{i.qty}</td><td className="num text-right">{fmtShort(i.unitPrice)}</td><td className="num text-right">{i.discountPct ? `${i.discountPct}%` : ''}</td><td className="num text-right">{fmtShort(line(i))}</td>
              <td className="w-10"><IconButton label="Remove line" onClick={async () => { const r = await A.removeDealItem(i.id); if (r.ok) router.refresh(); }}><Trash2 size={14} /></IconButton></td></tr>)}
              <tr><td colSpan={4} className="font-semibold">Subtotal ({deal.currency}, before VAT)</td><td className="num text-right font-bold">{fmtShort(itemsTotal)}</td><td /></tr>
              {margin != null && <tr><td colSpan={4} className="text-[13px]">Margin{costed.length < items.length ? ` (on ${costed.length} of ${items.length} lines with a cost price)` : ''}</td><td className={cn('num text-right font-bold', margin < minMargin ? 'text-bad' : 'text-good')}>{margin}%</td><td /></tr>}</tbody></table>
              {margin != null && margin < minMargin && <p className="border-t border-line bg-bad-soft px-5 py-2 text-[12.5px] text-bad">Margin is below the {minMargin}% minimum. Check discounts before sending the offer.</p>}</div>
            : <p className="px-5 py-6 text-[13px] text-muted">No products attached. Add line items to track what you’re selling and set the amount.</p>}
        </Panel>
        {(deal.contractStart || deal.contractEnd || deal.recurringValue != null || deal.poNumber || deal.paymentTerms || deal.tenderNumber || deal.submissionDeadline) && <Panel title="Contract & paperwork"><DetailGrid items={[
          ...(deal.contractStart || deal.contractEnd ? [['Contract', `${fmtDate(deal.contractStart)} → ${fmtDate(deal.contractEnd)}${deal.termMonths ? ` (${deal.termMonths} months)` : ''}`] as [string, React.ReactNode]] : []),
          ...(deal.recurringValue != null ? [['Recurring value', `${fmtMoney(deal.recurringValue, deal.currency)} / year`] as [string, React.ReactNode]] : []),
          ...(deal.tenderNumber || deal.submissionDeadline ? [['Tender / RFP', deal.tenderNumber], ['Submission deadline', fmtDate(deal.submissionDeadline)]] as [string, React.ReactNode][] : []),
          ...(deal.poNumber || deal.paymentTerms ? [['PO number', deal.poNumber], ['Payment terms', deal.paymentTerms]] as [string, React.ReactNode][] : []),
        ]} /></Panel>}
        {distributor && handlers.length > 0 && <Panel title={`Who to call at ${distributor.name}`} bodyClass="p-5"><div className="flex flex-col gap-2.5">{handlers.map((h) => <div key={h.id} className="flex flex-wrap items-center gap-2 text-[13px]">
          <Link href={`/contacts/${h.id}`} className="font-semibold hover:text-accent">{fullName(h)}</Link><span className="text-muted">handles</span>
          {h.productIds.filter((pid) => items.some((i) => i.productId === pid)).map((pid) => <Chip key={pid} tone="accent">{pname(pid)}</Chip>)}<span className="flex-1" /><span className="text-xs text-muted">{[h.mobile, h.email].filter(Boolean).join(' · ')}</span></div>)}</div></Panel>}
        {distributor && !handlers.length && items.length > 0 && <p className="rounded-xl bg-sunken px-4 py-2.5 text-[13px] text-muted">Nobody at {distributor.name} is recorded as handling these products yet. <Link className="font-semibold text-accent hover:underline" href={`/companies/${distributor.id}`}>Set product coverage</Link></p>}
        <PeoplePanel dealId={deal.id} people={people} />
        <ActivityPanel items={acts} relatedType="deal" relatedId={deal.id} />
        <NotesPanel items={notes} relatedType="deal" relatedId={deal.id} />
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <Panel title={<span className="inline-flex items-center gap-2"><Sparkles size={15} className="text-accent" />AI assistant</span>} bodyClass="p-5">
          {aiEnabled ? <>
            <div className="flex flex-wrap gap-2"><Button size="sm" variant="soft" disabled={ai.busy} onClick={() => runAi('brief')}>Summary & next steps</Button><Button size="sm" variant="soft" disabled={ai.busy} onClick={() => runAi('risk')}>Risk check</Button></div>
            {(ai.busy || ai.text) ? <div className="mt-3 whitespace-pre-wrap rounded-xl bg-accent-soft p-3.5 text-[13px] leading-relaxed">{ai.busy ? 'Reading the deal…' : ai.text}</div> : <p className="mt-3 text-[13px] text-muted">Reads this deal’s stage, products, activities and notes, then suggests what to do next.</p>}
          </> : <p className="text-[13px] text-muted">Add an <code className="rounded bg-sunken px-1">ANTHROPIC_API_KEY</code> to the server environment to turn on deal summaries, risk checks and email drafts.</p>}
        </Panel>
        <EmailsPanel items={emails} />
        <AttachmentsPanel items={files} relatedType="deal" relatedId={deal.id} />
        <Panel title="History" bodyClass="p-5">
          <ol className="relative flex flex-col gap-4 border-l border-line pl-5">{[...events].reverse().map((e) => <li key={e.id} className="relative">
            <span className={cn('absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-surface', e.kind === 'stage' ? 'bg-accent' : e.kind === 'created' ? 'bg-good' : 'bg-faint')} />
            <div className="text-[13px]">{e.kind === 'stage' ? <>Stage → <b>{sub.stages.find((s) => s.id === e.stageId)?.name || 'removed stage'}</b>{e.text && <span className="text-muted"> · {e.text.replace(/^(Won|Lost): /, '')}</span>}</> : e.text}</div>
            <div className="text-xs text-muted">{timeAgo(e.at)} · {who(e.userId)}</div></li>)}</ol>
        </Panel>
      </div>
    </div>
    {dialog}
    <EmailComposer open={email} onClose={() => setEmail(false)} to={contact?.email} ctx={{ firstName: contact?.firstName, lastName: contact?.lastName, company: company?.name, deal: deal.name, amount: fmtMoney(deal.amount, deal.currency) }} relatedType="deal" relatedId={deal.id} />
    {addItem && <AddItem deal={deal} rate={rate} onClose={() => setAddItem(false)} />}
  </div>;
}

function AddItem({ deal, rate, onClose }: { deal: Deal; rate: number; onClose: () => void }) {
  const { products } = useApp(); const toast = useToast(); const router = useRouter();
  const [pid, setPid] = useState(''); const [qty, setQty] = useState('1'); const [price, setPrice] = useState(''); const [disc, setDisc] = useState('0'); const [err, setErr] = useState('');
  const p = products.find((x) => x.id === pid);
  return <Modal open onClose={onClose} title="Add product" footer={<>{err && <span className="mr-auto text-[13px] text-bad">{err}</span>}<Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={async () => { if (!pid) return setErr('Choose a product.'); const r = await A.addDealItem(deal.id, pid, +qty || 1, price === '' ? null : +price, +disc || 0); if (!r.ok) return setErr(r.error); toast('Product added'); onClose(); router.refresh(); }}>Add</Button></>}>
    <div className="grid gap-3.5 pb-3 sm:grid-cols-2">
      <Field label="Product" required className="col-span-full"><Select value={pid} onChange={(e) => setPid(e.target.value)} autoFocus><option value="">Choose…</option>{products.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name} · AED {fmtShort(x.unitPrice)}</option>)}</Select></Field>
      <Field label="Quantity"><Input type="number" min={1} step="any" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
      <Field label={`Unit price (${deal.currency})`} hint={p ? `List price ${(p.unitPrice / rate).toFixed(0)} ${deal.currency}` : undefined}><Input type="number" min={0} step="any" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="List price" /></Field>
      <Field label="Discount %"><Input type="number" min={0} max={100} step="any" value={disc} onChange={(e) => setDisc(e.target.value)} /></Field>
    </div>
  </Modal>;
}

function PeoplePanel({ dealId, people }: { dealId: string; people: Person[] }) {
  const toast = useToast(); const router = useRouter(); const [add, setAdd] = useState(false); const [cid, setCid] = useState(''); const [role, setRole] = useState('Decision maker');
  const noDm = people.length > 0 && !people.some((p) => p.role === 'Decision maker');
  return <Panel title="People involved" count={people.length} actions={<Button size="sm" variant="soft" onClick={() => setAdd(true)}><Plus size={14} />Add</Button>}>
    {people.length ? people.map((p) => <div key={p.id} className="flex items-center gap-3 border-b border-line px-5 py-2.5 last:border-0">
      <Link href={`/contacts/${p.contactId}`} className="min-w-0 flex-1"><div className="truncate text-[13.5px] font-medium hover:text-accent">{fullName(p)}</div><div className="truncate text-xs text-muted">{[p.jobTitle, p.email].filter(Boolean).join(' · ')}</div></Link>
      {p.role && <Chip tone={p.role === 'Decision maker' ? 'good' : 'accent'}>{p.role}</Chip>}
      <IconButton label="Remove" onClick={async () => { const r = await A.removeDealContact(p.id); if (!r.ok) toast(r.error, 'bad'); else router.refresh(); }}><Trash2 size={14} /></IconButton></div>)
      : <p className="px-5 py-5 text-[13px] text-muted">Add everyone involved in the decision, with their role.</p>}
    {noDm && <p className="border-t border-line bg-warn-soft px-5 py-2 text-[12.5px] text-warn">No decision maker recorded yet.</p>}
    <Modal open={add} onClose={() => setAdd(false)} title="Add a person" footer={<><Button variant="ghost" onClick={() => setAdd(false)}>Cancel</Button><Button variant="primary" disabled={!cid} onClick={async () => { const r = await A.addDealContact(dealId, cid, role); if (!r.ok) return toast(r.error, 'bad'); setAdd(false); setCid(''); router.refresh(); }}>Add</Button></>}>
      <div className="grid gap-3 pb-24 sm:grid-cols-2"><Field label="Contact"><RecordPicker type="contact" value={cid} onChange={(id) => setCid(id)} ariaLabel="Contact" /></Field>
        <Field label="Role"><Select value={role} onChange={(e) => setRole(e.target.value)}>{DEAL_CONTACT_ROLES.map((r) => <option key={r}>{r}</option>)}</Select></Field></div>
    </Modal>
  </Panel>;
}
