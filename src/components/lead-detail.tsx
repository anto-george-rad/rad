'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, Mail, Pencil, Sparkles } from 'lucide-react';
import type { Activity, Attachment, Lead, Note, ScoringRule } from '@/db/schema';
import { Button, Chip, ConfirmButton, Field, Input, Modal, Panel, Select, useToast } from './ui';
import { useApp } from './app-context';
import { useForms } from './forms';
import { ActivityPanel, AttachmentsPanel, CopyText, DetailGrid, EmailComposer, FavoriteStar, NotesPanel, Owner, PhoneText, rememberRecent, useCustomItems } from './records';
import { DISQUAL_REASONS } from '@/lib/options';
import { HistoryPanel, type HistoryRow } from './records';
import { STATUS_TONE, ScoreChip } from './leads';
import * as A from '@/lib/actions';
import { addDaysISO, cn, DAY, fmtDate, fmtMoney, fullName } from '@/lib/utils';
import { SCORE_FIELD_LABELS } from '@/lib/scoring';

const STEPS = ['New', 'Contacted', 'Qualified', 'Unqualified', 'Converted'] as const;
export default function LeadDetail({ lead, score, hits, hot, warm, acts, notes, files, fav, matches, history }: { lead: Lead; score: number; hits: ScoringRule[]; hot: number; warm: number; acts: Activity[]; notes: Note[]; files: Attachment[]; fav: boolean;
  matches: { contact: { firstName: string; lastName: string | null } | null; company: { name: string } | null }; history: HistoryRow[] }) {
  const openForm = useForms(); const toast = useToast(); const router = useRouter(); const custom = useCustomItems(); const { customFields, products } = useApp();
  const [email, setEmail] = useState(false); const [convert, setConvert] = useState(false); const [disq, setDisq] = useState(false); const [why, setWhy] = useState('');
  useEffect(() => { rememberRecent({ type: 'lead', id: lead.id, label: fullName(lead), href: `/leads/${lead.id}` }); }, [lead]);
  const setStatus = async (s: Lead['status'], reason?: string) => { if (s === 'Unqualified' && !reason) { setWhy(''); return setDisq(true); } const r = await A.setLeadStatus([lead.id], s, reason); if (!r.ok) toast(r.error, 'bad'); else { setDisq(false); toast(`Status: ${s}`); r.ran.forEach((n) => toast(`Automation ran: ${n}`)); router.refresh(); } };
  const days = (a: Date | string, b: Date | string) => Math.max(0, Math.round((+new Date(b) - +new Date(a)) / DAY));
  const firstContact = lead.firstContactedAt ? `${days(lead.createdAt, lead.firstContactedAt) === 0 ? 'Same day' : `${days(lead.createdAt, lead.firstContactedAt)} days`} (${fmtDate(lead.firstContactedAt)})` : 'Not yet';
  const interest = products.find((p) => p.id === lead.productInterestId);
  const cfLabel = (f: string) => f.startsWith('cf:') ? customFields.find((x) => x.id === f.slice(3))?.label || 'Custom field' : SCORE_FIELD_LABELS[f] || f;
  return <div className="flex flex-col gap-4">
    <Link href="/leads" className="inline-flex w-max items-center gap-1.5 text-[13px] font-semibold text-muted hover:text-ink"><ArrowLeft size={15} />Leads</Link>
    <div className="flex flex-wrap items-start gap-4">
      <div className="min-w-0 flex-1"><p className="eyebrow">Lead</p><h1 className="font-display text-[30px] font-bold leading-tight tracking-tight">{fullName(lead)}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2"><ScoreChip score={score} hot={hot} warm={warm} /><Chip tone={STATUS_TONE[lead.status]}>{lead.status}</Chip>{lead.tags.map((t) => <Chip key={t} tone="outline">{t}</Chip>)}{[lead.jobTitle, lead.companyName].filter(Boolean).length > 0 && <span className="text-[13.5px] text-muted">{[lead.jobTitle, lead.companyName].filter(Boolean).join(' at ')}</span>}</div></div>
      <div className="flex flex-wrap gap-2">
        <FavoriteStar type="lead" id={lead.id} label={fullName(lead)} on={fav} />
        <Button onClick={() => setEmail(true)} disabled={lead.doNotContact}><Mail size={15} />Email</Button>
        <Button onClick={() => openForm('lead', lead as never)}><Pencil size={15} />Edit</Button>
        {lead.status !== 'Converted' && <Button variant="primary" onClick={() => setConvert(true)}>Convert</Button>}
        <ConfirmButton variant="ghost" confirmText="Delete lead?" onConfirm={async () => { const r = await A.deleteRecords('lead', [lead.id]); if (!r.ok) toast(r.error, 'bad'); else { toast('Lead deleted'); router.push('/leads'); } }}>Delete</ConfirmButton>
      </div>
    </div>
    <div className="flex gap-1 overflow-x-auto">{STEPS.map((s, i) => { const cur = s === lead.status; const past = STEPS.indexOf(lead.status) > i && lead.status !== 'Unqualified' && s !== 'Unqualified';
      return <button key={s} disabled={s === 'Converted'} onClick={() => setStatus(s)} className={cn('flex-1 whitespace-nowrap px-4 py-2.5 text-[12.5px] font-semibold transition first:rounded-l-xl last:rounded-r-xl disabled:cursor-default',
        cur ? (s === 'Unqualified' ? 'bg-bad text-white' : s === 'Converted' ? 'bg-good text-white' : 'bg-accent text-accent-ink') : past ? 'bg-accent-soft text-accent' : 'bg-sunken text-muted hover:text-ink')}>{s}</button>; })}</div>
    {lead.doNotContact && <div className="flex items-center gap-2 rounded-xl border border-bad/30 bg-bad-soft px-4 py-2.5 text-[13px] font-semibold text-bad"><AlertTriangle size={16} />Do not contact — this person asked not to be contacted for sales.</div>}
    {lead.status === 'Unqualified' && lead.disqualReason && <div className="rounded-xl bg-sunken px-4 py-2.5 text-[13px] text-muted">Unqualified: <b className="text-ink">{lead.disqualReason}</b></div>}
    <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
      <div className="flex min-w-0 flex-col gap-4">
        <Panel title="Details"><DetailGrid items={[['Email', <CopyText key="e" value={lead.email} />], ['Phone', <PhoneText key="p" value={lead.phone} />], ['Company', lead.companyName], ['Job title', lead.jobTitle],
          ['Industry', lead.industry], ['Emirate', lead.emirate], ['Website', lead.website ? <a key="w" className="text-accent hover:underline" target="_blank" rel="noopener" href={/^https?:/.test(lead.website) ? lead.website : `https://${lead.website}`}>{lead.website}</a> : null], ['Company size', lead.companySize],
          ['Budget', lead.budget != null ? fmtMoney(lead.budget) : null], ['Timeline', lead.timeline], ['Product of interest', interest?.name], ['Source', [lead.source, lead.campaign].filter(Boolean).join(' · ') || null],
          ['First contact', firstContact], ['Consent', lead.consent ? `Yes${lead.consentAt ? `, ${fmtDate(lead.consentAt)}` : ''}` : 'Not recorded'],
          ['Owner', <Owner key="o" id={lead.ownerId} />], ['Added', fmtDate(lead.createdAt)],
          ...(lead.convertedAt ? [['Converted', <span key="c">{fmtDate(lead.convertedAt)}{lead.convertedContactId && <> · <Link className="text-accent hover:underline" href={`/contacts/${lead.convertedContactId}`}>contact</Link></>}{lead.convertedDealId && <> · <Link className="text-accent hover:underline" href={`/deals/${lead.convertedDealId}`}>deal</Link></>}</span>] as [string, React.ReactNode]] : []),
          ...custom('lead', lead.custom), ...(lead.notes ? [['Notes', <span key="n" className="whitespace-pre-wrap">{lead.notes}</span>] as [string, React.ReactNode]] : [])]} /></Panel>
        <ActivityPanel items={acts} relatedType="lead" relatedId={lead.id} />
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <Panel title="Lead score" actions={<Link href="/settings?tab=scoring" className="text-xs font-semibold text-accent hover:underline">Edit rules</Link>} bodyClass="p-5">
          <div className="flex items-end gap-3"><span className="num font-display text-5xl font-bold leading-none" style={{ fontFamily: '"Manrope Variable","Manrope",sans-serif' }}>{score}</span><span className="pb-1 text-muted">/ 100</span></div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-sunken"><i className={cn('block h-full rounded-full', score >= hot ? 'bg-bad' : score >= warm ? 'bg-warn' : 'bg-accent')} style={{ width: `${score}%` }} /></div>
          <ul className="mt-4 flex flex-col gap-1.5">{hits.length ? hits.map((h) => <li key={h.id} className="flex justify-between text-[13px]"><span>{cfLabel(h.field)} {h.operator === 'filled' ? 'filled in' : h.operator === 'is' ? `is ${h.value}` : 'matches'}</span><span className="num text-good">+{h.points}</span></li>) : <li className="text-[13px] text-muted">No rules matched yet. Fill in more details to raise the score.</li>}</ul>
        </Panel>
        <NotesPanel items={notes} relatedType="lead" relatedId={lead.id} />
        <AttachmentsPanel items={files} relatedType="lead" relatedId={lead.id} />
        <HistoryPanel rows={history} />
      </div>
    </div>
    <EmailComposer open={email} onClose={() => setEmail(false)} to={lead.email} ctx={{ firstName: lead.firstName, lastName: lead.lastName, company: lead.companyName }} relatedType="lead" relatedId={lead.id} />
    {convert && <ConvertModal lead={lead} matchC={matches.contact} matchCo={matches.company} onClose={() => setConvert(false)} />}
    <Modal open={disq} onClose={() => setDisq(false)} title="Why is this lead unqualified?" footer={<><Button variant="ghost" onClick={() => setDisq(false)}>Cancel</Button><Button variant="primary" disabled={!why} onClick={() => setStatus('Unqualified', why)}>Mark unqualified</Button></>}>
      <div className="grid gap-2 pb-3 sm:grid-cols-2">{DISQUAL_REASONS.map((r) => <button key={r} type="button" onClick={() => setWhy(r)} className={cn('rounded-lg border px-3 py-2 text-left text-[13px] font-semibold', why === r ? 'border-accent bg-accent-soft text-accent' : 'border-line hover:border-faint')}>{r}</button>)}</div>
    </Modal>
  </div>;
}

function ConvertModal({ lead, onClose, matchC, matchCo }: { lead: Lead; onClose: () => void; matchC: { firstName: string; lastName: string | null } | null; matchCo: { name: string } | null }) {
  const { pipelines, settings } = useApp(); const toast = useToast(); const router = useRouter();
  const [mk, setMk] = useState(true); const [name, setName] = useState(`${lead.companyName || fullName(lead)} – new opportunity`);
  const [pid, setPid] = useState(pipelines[0]?.id); const p = pipelines.find((x) => x.id === pid);
  const stageOpts = p?.subs.flatMap((s) => s.stages.filter((x) => x.type === 'open').map((x) => ({ v: `${s.id}:${x.id}`, l: (p.subs.length > 1 ? `${s.name} · ` : '') + x.name }))) || [];
  const [st, setSt] = useState(stageOpts[0]?.v || ''); const [amount, setAmount] = useState(''); const [cur, setCur] = useState('AED'); const [close, setClose] = useState(addDaysISO(30));
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  return <Modal open onClose={onClose} title="Convert lead" sub={`${fullName(lead)} becomes a contact${lead.companyName ? ', linked to a company' : ''}, with an optional deal.`}
    footer={<>{err && <span className="mr-auto text-[13px] text-bad">{err}</span>}<Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy} onClick={async () => {
      setBusy(true); const [subId, stageId] = st.split(':');
      const r = await A.convertLead(lead.id, { createDeal: mk, dealName: name, pipelineId: pid, subPipelineId: subId, stageId, amount: amount === '' ? null : +amount, currency: cur, closingDate: close });
      setBusy(false); if (!r.ok) return setErr(r.error); toast('Lead converted'); onClose(); router.push(r.dealId ? `/deals/${r.dealId}` : `/contacts/${r.contactId}`);
    }}>{busy ? 'Converting…' : 'Convert'}</Button></>}>
    <div className="flex flex-col gap-3.5 pb-3">
      <div className="rounded-xl bg-raised p-3.5 text-[13px]"><p>Contact: {matchC ? <>links to existing <b>{fullName(matchC)}</b> (same email)</> : <>creates <b>{fullName(lead)}</b></>}</p>
        {lead.companyName && <p className="mt-1">Company: {matchCo ? <>links to existing <b>{matchCo.name}</b></> : <>creates <b>{lead.companyName}</b></>}</p>}</div>
      <label className="flex items-center gap-2 text-[13.5px] font-semibold"><input type="checkbox" checked={mk} onChange={(e) => setMk(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--accent))]" />Create a deal</label>
      {mk && <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Deal name" className="col-span-full"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Pipeline"><Select value={pid} onChange={(e) => { setPid(e.target.value); const np = pipelines.find((x) => x.id === e.target.value); const f = np?.subs[0]; setSt(f ? `${f.id}:${f.stages.find((x) => x.type === 'open')?.id}` : ''); }}>{pipelines.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
        <Field label="Stage"><Select value={st} onChange={(e) => setSt(e.target.value)}>{stageOpts.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</Select></Field>
        <div className="flex gap-2"><Field label="Amount" className="flex-1"><Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field><Field label="Currency" className="w-24"><Select value={cur} onChange={(e) => setCur(e.target.value)}>{Object.keys(settings.currencies).map((c) => <option key={c}>{c}</option>)}</Select></Field></div>
        <Field label="Closing date"><Input type="date" value={close} onChange={(e) => setClose(e.target.value)} /></Field>
      </div>}
      <p className="flex items-center gap-1.5 text-xs text-muted"><Sparkles size={13} />Open activities move to the new deal; notes move to the contact.</p>
    </div>
  </Modal>;
}
