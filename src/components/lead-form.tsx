'use client';
import { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Button, Field, Input, Select, Textarea } from './ui';

/** The hosted website form (embeddable in an iframe on raidefend.com). */
export function LeadFormPublic({ orgName, products }: { orgName: string; products: string[] }) {
  const [v, setV] = useState({ name: '', email: '', phone: '', company: '', jobTitle: '', product: '', message: '', consent: false, website: '' });
  const [t, setT] = useState(0); const [state, setState] = useState<{ ok?: string; error?: string; busy?: boolean }>({});
  useEffect(() => setT(Date.now()), []);
  if (state.ok) return <div className="flex flex-col items-center gap-3 py-10 text-center"><CheckCircle2 size={40} className="text-good" /><p className="max-w-sm text-[15px]">{state.ok}</p></div>;
  return <form className="grid gap-3.5 sm:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); setState({ busy: true });
    const r = await fetch('/api/forms/lead', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...v, t, page: document.referrer || undefined }) }).then((x) => x.json()).catch(() => ({ ok: false, message: 'Couldn’t send. Check your connection and try again.' }));
    setState(r.ok ? { ok: r.message } : { error: r.message }); }}>
    <div className="col-span-full"><h1 className="font-display text-[22px] font-bold">Talk to {orgName}</h1><p className="text-[13.5px] text-muted">Tell us what you need and our team will get back to you.</p></div>
    <Field label="Your name" required><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} autoComplete="name" required /></Field>
    <Field label="Company"><Input value={v.company} onChange={(e) => setV({ ...v, company: e.target.value })} autoComplete="organization" /></Field>
    <Field label="Work email"><Input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} autoComplete="email" /></Field>
    <Field label="Mobile"><Input type="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} autoComplete="tel" placeholder="+971 5x xxx xxxx" /></Field>
    <Field label="Job title"><Input value={v.jobTitle} onChange={(e) => setV({ ...v, jobTitle: e.target.value })} autoComplete="organization-title" /></Field>
    {products.length > 0 ? <Field label="Interested in"><Select value={v.product} onChange={(e) => setV({ ...v, product: e.target.value })}><option value="">Not sure yet</option>{products.map((p) => <option key={p}>{p}</option>)}</Select></Field> : <span />}
    <Field label="How can we help?" className="col-span-full"><Textarea value={v.message} onChange={(e) => setV({ ...v, message: e.target.value })} className="min-h-[110px]" /></Field>
    <input name="website" value={v.website} onChange={(e) => setV({ ...v, website: e.target.value })} className="hidden" tabIndex={-1} autoComplete="off" aria-hidden />
    <label className="col-span-full flex items-start gap-2 text-[13px]"><input type="checkbox" checked={v.consent} onChange={(e) => setV({ ...v, consent: e.target.checked })} className="mt-0.5 h-4 w-4 accent-[rgb(var(--accent))]" />I agree that {orgName} may contact me about this request.</label>
    {state.error && <p role="alert" className="col-span-full rounded-lg bg-bad-soft px-3 py-2 text-[13px] font-medium text-bad">{state.error}</p>}
    <div className="col-span-full"><Button variant="primary" className="h-11 w-full sm:w-auto" disabled={state.busy}>{state.busy ? 'Sending…' : 'Send'}</Button></div>
  </form>;
}
