'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Papa from 'papaparse';
import { Upload } from 'lucide-react';
import { Button, Field, Modal, Select, useToast } from './ui';
import { importRows } from '@/lib/actions';
import { importTickets } from '@/lib/desk-ext-actions';
import { useApp } from './app-context';

type Ent = 'lead' | 'contact' | 'company' | 'deal' | 'activity' | 'ticket';
const FIELDS: Record<Ent, [string, string, RegExp][]> = {
  ticket: [['subject', 'Subject', /subject|title|summary/], ['description', 'Description / first message', /desc|body|message|details/], ['requesterEmail', 'Requester email', /e-?mail/], ['requesterName', 'Requester name', /requester|contact|customer|^name$/], ['requesterPhone', 'Requester phone', /phone|mobile/], ['company', 'Company', /company|account|organi[sz]ation/], ['status', 'Status', /status|state/], ['priority', 'Priority', /priority|severity/], ['department', 'Department', /department|group|queue/], ['assigneeEmail', 'Assignee email', /assignee|agent|owner/], ['channel', 'Channel', /channel|source|mode/], ['type', 'Type', /^type/], ['category', 'Category', /categor/], ['tags', 'Tags', /tag/], ['createdAt', 'Created date', /creat|opened|^date/], ['firstResponseAt', 'First response date', /first.?resp/], ['resolvedAt', 'Resolved date', /resolv|closed/], ['resolution', 'Resolution / last reply', /resolution|solution|answer/], ['externalId', 'Old ticket ID', /^id$|ticket.?(id|no|number)|number|ref/]],
  deal: [['name', 'Deal name', /deal|opportunit|^name$|title/], ['amount', 'Amount', /amount|value|price/], ['currency', 'Currency', /curr/], ['company', 'Company', /company|account|organi[sz]ation/], ['contactEmail', 'Contact email', /e-?mail/], ['pipeline', 'Pipeline', /pipeline/], ['stage', 'Stage', /stage|status/], ['closingDate', 'Closing date (YYYY-MM-DD or DD/MM/YYYY)', /clos|expected/], ['owner', 'Owner (email or name)', /owner|rep|sales ?person/], ['source', 'Lead source', /source/]],
  activity: [['title', 'Title', /title|subject|task|^name$/], ['type', 'Type (task, call, meeting, email, whatsapp)', /type/], ['dueDate', 'Due date', /due|date/], ['owner', 'Owner (email or name)', /owner|assign/], ['contactEmail', 'Contact email', /e-?mail/], ['company', 'Company', /company|account/], ['details', 'Details', /detail|note|description/], ['done', 'Done? (yes/no)', /done|complete|status/]],
  lead: [['firstName', 'First name', /^first|^given|^name$|full ?name/], ['lastName', 'Last name', /^last|surname|family/], ['company', 'Company', /company|organi[sz]ation|account/], ['jobTitle', 'Job title', /title|position|role|designation/], ['email', 'Email', /e-?mail/], ['phone', 'Phone', /phone|mobile|tel/], ['source', 'Source', /source|channel/], ['tags', 'Tags', /tag|label/], ['notes', 'Notes', /note|description|comment|message/]],
  contact: [['firstName', 'First name', /^first|^given|^name$|full ?name/], ['lastName', 'Last name', /^last|surname|family/], ['company', 'Company', /company|organi[sz]ation|account/], ['jobTitle', 'Job title', /title|position|role|designation/], ['email', 'Email', /e-?mail/], ['phone', 'Phone', /phone|mobile|tel/], ['source', 'Source', /source/], ['tags', 'Tags', /tag|label/]],
  company: [['name', 'Company name', /company|organi[sz]ation|account|^name$/], ['industry', 'Industry', /industry|sector/], ['website', 'Website', /web|url|domain/], ['phone', 'Phone', /phone|tel/], ['city', 'City', /city|emirate|town/], ['country', 'Country', /country/], ['vatTrn', 'VAT TRN', /trn|vat|tax/]],
};
const LABEL: Record<Ent, string> = { lead: 'leads', contact: 'contacts', company: 'companies', deal: 'deals', activity: 'activities', ticket: 'ticket history' };

export function ImportButton({ entity }: { entity: Ent }) {
  const [open, setOpen] = useState(false);
  const { me } = useApp(); if (entity === 'ticket' ? me.deskRole !== 'admin' : me.role === 'rep' || !me.perms.importData) return null;
  return <><Button onClick={() => setOpen(true)}><Upload size={15} />Import</Button>{open && <ImportModal entity={entity} onClose={() => setOpen(false)} />}</>;
}
export function ImportModal({ entity, onClose }: { entity: Ent; onClose: () => void }) {
  const toast = useToast(); const router = useRouter();
  const [rows, setRows] = useState<string[][] | null>(null); const [map, setMap] = useState<Record<string, string>>({}); const [mode, setMode] = useState<'skip' | 'update'>('skip');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const F = FIELDS[entity]; const need = entity === 'company' || entity === 'deal' ? 'name' : entity === 'activity' ? 'title' : entity === 'ticket' ? 'subject' : 'firstName';
  const onFile = (file: File) => Papa.parse<string[]>(file, { skipEmptyLines: true, complete: (res) => {
    const data = res.data.filter((r) => r.some((c) => String(c).trim())); if (data.length < 2) { setErr('The file needs a header row and at least one data row.'); return; }
    setErr(''); setRows(data); const hdr = data[0].map((h) => String(h).toLowerCase().trim()); const used = new Set<number>(); const m: Record<string, string> = {};
    for (const [k, , re] of F) { const i = hdr.findIndex((h, ix) => !used.has(ix) && re.test(h)); if (i >= 0) { used.add(i); m[k] = String(i); } }
    setMap(m);
  } });
  const run = async () => {
    if (!rows) return setErr('Choose a CSV file first.'); if (map[need] == null || map[need] === '') return setErr(`Match a column to ${F.find((f) => f[0] === need)![1]}.`);
    setBusy(true); setErr('');
    const objs = rows.slice(1).map((r) => Object.fromEntries(Object.entries(map).filter(([, v]) => v !== '').map(([k, v]) => [k, r[+v] ?? ''])));
    const res = entity === 'ticket' ? await importTickets(objs, mode) : await importRows(entity, objs, mode); setBusy(false);
    if (!res.ok) return setErr(res.error);
    const errs = 'errors' in res ? (res.errors as string[]) : []; if (errs.length) toast(`${errs.length} row problem(s): ${errs[0]}`, 'bad');
    toast(`Imported ${res.created} new, ${res.updated} updated, ${res.skipped} skipped`); onClose(); router.refresh();
  };
  return <Modal open wide onClose={onClose} title={`Import ${LABEL[entity]}`} sub="A CSV with a header row from Excel, Google Sheets, Bigin or another CRM."
    footer={<>{err && <span className="mr-auto text-[13px] font-medium text-bad">{err}</span>}<Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={busy || !rows} onClick={run}>{busy ? 'Importing…' : rows ? `Import ${rows.length - 1} rows` : 'Import'}</Button></>}>
    <div className="flex flex-col gap-4 pb-3">
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-[1.5px] border-dashed border-line bg-raised px-6 py-8 text-center transition hover:border-accent">
        <Upload className="text-accent" /><span className="text-[13.5px] font-semibold">{rows ? `${rows.length - 1} rows loaded. Choose another file to replace.` : 'Choose a CSV file'}</span><span className="text-xs text-muted">UTF-8 CSV, up to 5,000 rows per import</span>
        <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      </label>
      {rows && <>
        {entity === 'ticket' && <p className="text-xs text-muted">Export from your old helpdesk (Zoho Desk, Freshdesk, a mailbox export) as CSV. Requesters are matched to contacts by email (or created); status, department and assignee are matched by name/email. With an old ticket ID, re-importing updates instead of duplicating.</p>}
        {entity === 'deal' && <p className="text-xs text-muted">Pipeline and stage are matched by name (first pipeline and stage if blank). Companies are created when missing; contacts are matched by email.</p>}
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">{F.map(([k, l]) => <Field key={k} label={l} required={k === need}><Select value={map[k] ?? ''} onChange={(e) => setMap((m) => ({ ...m, [k]: e.target.value }))}><option value="">Skip</option>{rows[0].map((h, i) => <option key={i} value={i}>{h} — e.g. {String(rows[1][i] ?? '').slice(0, 26)}</option>)}</Select></Field>)}</div>
        {entity !== 'activity' && <Field label={`When a match already exists (same ${entity === 'ticket' ? 'old ticket ID' : entity === 'company' || entity === 'deal' ? 'name' : 'email'})`}><Select value={mode} onChange={(e) => setMode(e.target.value as 'skip')}><option value="skip">Skip the row</option><option value="update">Update the existing record</option></Select></Field>}
      </>}
    </div>
  </Modal>;
}
