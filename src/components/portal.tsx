'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Frown, Meh, Paperclip, Smile } from 'lucide-react';
import { Button, Field, Input, Select, Textarea, useToast } from './ui';
import * as P from '@/lib/portal-actions';
import { cn, passwordProblem } from '@/lib/utils';

export function PortalSignOut({ name }: { name: string }) {
  return <form action={P.portalLogout}><button className="rounded-lg px-3 py-2 text-muted hover:bg-sunken hover:text-ink" title={`Signed in as ${name}`}>Sign out</button></form>;
}
export function ArticleVote({ slug }: { slug: string }) {
  const [done, setDone] = useState(false);
  return <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-line pt-5 text-[13.5px]">
    {done ? <span className="text-good">Thanks for letting us know.</span> : <><span className="text-muted">Was this article helpful?</span>
      <Button size="sm" onClick={async () => { await P.kbVote(slug, true); setDone(true); }}>Yes</Button><Button size="sm" onClick={async () => { await P.kbVote(slug, false); setDone(true); }}>No</Button></>}
    <span className="flex-1" /><Link href="/portal/new" className="font-semibold text-accent hover:underline">Still need help? Submit a request</Link>
  </div>;
}
const Card = ({ children }: { children: React.ReactNode }) => <div className="panel mx-auto w-full max-w-md p-6 md:p-8">{children}</div>;
const Err = ({ e }: { e: string }) => e ? <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-[13px] font-medium text-bad">{e}</p> : null;

export function PortalLogin() {
  const [mode, setMode] = useState<'in' | 'forgot'>('in'); const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  return <Card>
    <h1 className="font-display text-2xl font-bold">{mode === 'in' ? 'Sign in' : 'Reset your password'}</h1>
    <p className="mt-1 text-[13.5px] text-muted">{mode === 'in' ? 'Use the email address support invited.' : 'We’ll email you a link to choose a new password.'}</p>
    <form className="mt-6 grid gap-4" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(''); if (mode === 'in') { const r = await P.portalLogin(email, pw); if (r && !r.ok) setErr(r.error); } else { const r = await P.portalForgot(email); if (r.ok) setMsg(r.message); else setErr(r.error); } setBusy(false); }}>
      <Field label="Email"><Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></Field>
      {mode === 'in' && <Field label="Password"><Input type="password" autoComplete="current-password" required value={pw} onChange={(e) => setPw(e.target.value)} /></Field>}
      <Err e={err} />{msg && <p role="status" className="rounded-lg bg-accent-soft px-3 py-2 text-[13px] text-accent">{msg}</p>}
      <Button variant="primary" className="h-11" disabled={busy || (mode === 'forgot' && !!msg)}>{busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : 'Send reset link'}</Button>
      <button type="button" onClick={() => { setMode(mode === 'in' ? 'forgot' : 'in'); setErr(''); setMsg(''); }} className="text-[13px] font-semibold text-accent hover:underline">{mode === 'in' ? 'Forgot password?' : 'Back to sign in'}</button>
    </form>
    <p className="mt-6 border-t border-line pt-4 text-center text-[13px] text-muted">No account? <Link className="font-semibold text-accent hover:underline" href="/portal/new">Submit a request</Link> without signing in.</p>
  </Card>;
}
export function PortalSetPassword({ token }: { token: string }) {
  const router = useRouter(); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  if (!token) return <Card><h1 className="font-display text-2xl font-bold">Link missing</h1><p className="mt-2 text-muted">Open the link from your invitation email, or ask support for a new one.</p></Card>;
  return <Card>
    <h1 className="font-display text-2xl font-bold">Choose a password</h1><p className="mt-1 text-[13.5px] text-muted">At least 10 characters, with letters and numbers.</p>
    <form className="mt-6 grid gap-4" onSubmit={async (e) => { e.preventDefault(); setErr(''); const p = passwordProblem(pw); if (p) return setErr(p); if (pw !== pw2) return setErr('The two passwords don’t match.'); setBusy(true); const r = await P.portalSetPassword(token, pw); setBusy(false); if (!r.ok) return setErr(r.error); router.push('/portal/tickets'); router.refresh(); }}>
      <Field label="New password"><Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus /></Field>
      <Field label="Repeat it"><Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
      <Err e={err} /><Button variant="primary" className="h-11" disabled={busy}>{busy ? 'Saving…' : 'Save and continue'}</Button>
    </form>
  </Card>;
}
export function PortalNewTicket({ signedIn, name, products, departments }: { signedIn: boolean; name: string; products: { id: string; name: string }[]; departments: { id: string; name: string }[] }) {
  const router = useRouter(); const started = useRef(Date.now());
  const [v, setV] = useState({ name: '', email: '', phone: '', company: '', subject: '', description: '', productId: '', priority: 'Medium', departmentId: '', website: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [done, setDone] = useState(''); const [sug, setSug] = useState<{ title: string; slug: string }[]>([]);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((o) => ({ ...o, [k]: e.target.value }));
  useEffect(() => { const t = setTimeout(async () => { if (v.subject.trim().length < 4) return setSug([]); try { const r = await fetch(`/api/portal/suggest?q=${encodeURIComponent(v.subject)}`); if (r.ok) setSug((await r.json()).items); } catch { /* offline */ } }, 350); return () => clearTimeout(t); }, [v.subject]);
  if (done) return <Card><CheckCircle2 className="text-good" size={36} /><h1 className="mt-3 font-display text-2xl font-bold">Request received</h1><p className="mt-2 text-muted">Your reference is <b className="num text-ink">#{done}</b>. We’ve sent a confirmation by email and will reply there.</p><Link href="/portal" className="mt-5 inline-block font-semibold text-accent hover:underline">Back to the help centre</Link></Card>;
  return <div className="mx-auto max-w-2xl">
    <h1 className="font-display text-[28px] font-bold">Submit a request</h1>
    <p className="mt-1 text-muted">{signedIn ? `Signed in as ${name}. We’ll reply here and by email.` : <>We’ll reply by email. Already have an account? <Link className="font-semibold text-accent hover:underline" href="/portal/login">Sign in</Link> to track your requests.</>}</p>
    <form className="panel mt-5 grid gap-4 p-6 sm:grid-cols-2" noValidate onSubmit={async (e) => {
      e.preventDefault(); setErr(''); setBusy(true);
      if (signedIn) { const r = await P.portalCreateTicket({ subject: v.subject, description: v.description, productId: v.productId || undefined, priority: v.priority, departmentId: v.departmentId || undefined }); setBusy(false); if (!r.ok) return setErr(r.error); router.push(`/portal/tickets/${r.id}`); return; }
      const r = await P.submitWebForm({ ...v, productId: v.productId || undefined, startedAt: started.current }); setBusy(false); if (!r.ok) return setErr(r.error); setDone(r.number);
    }}>
      {!signedIn && <><Field label="Your name" required><Input value={v.name} onChange={set('name')} autoComplete="name" /></Field><Field label="Email" required><Input type="email" value={v.email} onChange={set('email')} autoComplete="email" /></Field>
        <Field label="Phone"><Input type="tel" value={v.phone} onChange={set('phone')} autoComplete="tel" /></Field><Field label="Company"><Input value={v.company} onChange={set('company')} autoComplete="organization" /></Field></>}
      <Field label="Subject" required className="sm:col-span-2"><Input value={v.subject} onChange={set('subject')} placeholder="e.g. Licence key not accepted" /></Field>
      {sug.length > 0 && <div className="rounded-xl bg-accent-soft p-3 text-[13px] sm:col-span-2"><b>These articles might help:</b>{sug.map((a) => <Link key={a.slug} href={`/portal/kb/${a.slug}`} target="_blank" className="mt-1 block text-accent hover:underline">{a.title}</Link>)}</div>}
      {products.length > 0 && <Field label="Product"><Select value={v.productId} onChange={set('productId')}><option value="">Not sure / other</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>}
      {signedIn && <Field label="How urgent is it?"><Select value={v.priority} onChange={set('priority')}><option value="Low">Low — a question</option><option value="Medium">Normal</option><option value="High">High — work is blocked</option></Select></Field>}
      {signedIn && departments.length > 1 && <Field label="Team"><Select value={v.departmentId} onChange={set('departmentId')}><option value="">Let support decide</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>}
      <Field label="Describe the problem" required className="sm:col-span-2"><Textarea value={v.description} onChange={set('description')} className="min-h-[160px]" placeholder="What happened, what you expected, and any error messages" /></Field>
      <input type="text" name="website" value={v.website} onChange={set('website')} tabIndex={-1} autoComplete="off" aria-hidden className="absolute -left-[9999px] h-0 w-0 opacity-0" />
      <div className="sm:col-span-2"><Err e={err} /></div>
      <div className="flex items-center gap-3 sm:col-span-2"><Button variant="primary" className="h-11 px-6" disabled={busy}>{busy ? 'Sending…' : 'Send request'}</Button>{signedIn && <span className="text-xs text-muted">You can add files from the request page after sending.</span>}</div>
    </form>
  </div>;
}
type Msg = { id: string; mine: boolean; who: string; body: string; at: Date; files?: { id: string; fileName: string; size: number }[] };
export function PortalTicket({ t, threads, files, csat }: { t: { id: string; label: string; subject: string; cat: string; createdAt: Date; rating: string | null; merged: boolean }; threads: Msg[]; files: { id: string; fileName: string; size: number }[]; csat: boolean }) {
  const router = useRouter(); const toast = useToast(); const [body, setBody] = useState(''); const [busy, setBusy] = useState(false); const [comment, setComment] = useState(''); const [rated, setRated] = useState(t.rating);
  const upload = async (fl: FileList | null) => {
    if (!fl?.length) return; setBusy(true);
    for (const f of Array.from(fl)) { const fd = new FormData(); fd.append('file', f); fd.append('ticketId', t.id); const r = await fetch('/api/portal/files', { method: 'POST', body: fd }).catch(() => null); if (!r?.ok) toast((await r?.json().catch(() => null))?.error || `Couldn’t upload ${f.name}`, 'bad'); }
    setBusy(false); router.refresh();
  };
  return <div className="mx-auto max-w-3xl">
    <Link href="/portal/tickets" className="text-[13px] font-semibold text-muted hover:text-ink">← My requests</Link>
    <div className="mt-3 flex flex-wrap items-start gap-3"><div className="min-w-0 flex-1"><p className="num text-xs text-muted">{t.label}</p><h1 className="font-display text-[26px] font-bold leading-tight">{t.subject}</h1></div>
      <span className={`chip ${t.cat === 'closed' ? 'bg-good-soft text-good' : t.cat === 'onhold' ? 'bg-warn-soft text-warn' : 'bg-accent-soft text-accent'}`}>{t.cat === 'closed' ? 'Resolved' : t.cat === 'onhold' ? 'Awaiting your reply' : 'Open'}</span></div>
    {t.merged && <p className="mt-3 rounded-xl bg-sunken px-4 py-2.5 text-[13px]">This request was combined with another one about the same issue. Updates continue there.</p>}
    <div className="mt-5 flex flex-col gap-3">{threads.map((m) => <article key={m.id} className={cn('rounded-2xl border px-4 py-3', m.mine ? 'mr-6 border-line bg-surface' : 'ml-6 border-accent/25 bg-accent-soft/60')}>
      <header className="mb-1 text-xs"><b>{m.mine ? m.who : `${m.who} · Support`}</b> <span className="text-muted">· {new Date(m.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></header>
      <div className="whitespace-pre-wrap break-words text-[14px] leading-relaxed">{m.body}</div>
      {!!m.files?.length && <div className="mt-2 flex flex-wrap gap-1.5">{m.files.map((f) => <a key={f.id} href={`/api/portal/files/${f.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs font-semibold hover:border-accent"><Paperclip size={12} />{f.fileName}</a>)}</div>}</article>)}</div>
    {files.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{files.map((f) => <a key={f.id} href={`/api/portal/files/${f.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold hover:border-accent"><Paperclip size={12} />{f.fileName}</a>)}</div>}
    {t.cat === 'closed' && csat && <div className="panel mt-5 p-5">{rated ? <p className="text-[14px]">Thanks for rating our support <b>{rated === 'good' ? 'great' : rated === 'ok' ? 'okay' : 'not good'}</b>. Reply below if the problem comes back.</p> : <>
      <p className="font-semibold">How did we do?</p>
      <div className="mt-3 flex flex-wrap gap-2">{([['good', 'Great', Smile], ['ok', 'Okay', Meh], ['bad', 'Not good', Frown]] as const).map(([k, l, I]) => <Button key={k} onClick={async () => { const r = await P.portalRate(t.id, k, comment); if (!r.ok) return toast(r.error, 'bad'); setRated(k); }}><I size={16} />{l}</Button>)}</div>
      <Input className="mt-3" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Anything you’d like to add? (optional)" aria-label="Comment" /></>}</div>}
    {!t.merged && <div className="panel mt-5 p-5">
      <Field label={t.cat === 'closed' ? 'Problem not fixed? Reply to reopen it' : 'Reply'}><Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[110px]" /></Field>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={busy || !body.trim()} onClick={async () => { setBusy(true); const r = await P.portalReply(t.id, body); setBusy(false); if (!r.ok) return toast(r.error, 'bad'); setBody(''); toast('Sent'); router.refresh(); }}>Send</Button>
        <label className={cn('inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[13px] font-semibold', busy && 'opacity-50')}><Paperclip size={14} />Attach file<input type="file" multiple className="sr-only" disabled={busy} onChange={(e) => { upload(e.target.files); e.target.value = ''; }} /></label>
        <span className="flex-1" />{t.cat !== 'closed' && <Button variant="ghost" onClick={async () => { const r = await P.portalResolve(t.id); if (!r.ok) return toast(r.error, 'bad'); toast('Marked as resolved'); router.refresh(); }}>My problem is solved</Button>}
      </div></div>}
  </div>;
}
export function RateThanks({ ok, error, id, tok, v }: { ok: boolean; error: string; id: string; tok: string; v: string }) {
  const [c, setC] = useState(''); const [sent, setSent] = useState(false);
  return <div className="panel w-full max-w-md p-8 text-center">
    {ok ? <><CheckCircle2 className="mx-auto text-good" size={40} /><h1 className="mt-3 font-display text-2xl font-bold">Thank you!</h1><p className="mt-1 text-muted">We’ve recorded your rating: <b className="text-ink">{v === 'good' ? 'Great' : v === 'ok' ? 'Okay' : 'Not good'}</b>.</p>
      {sent ? <p className="mt-4 text-good">Comment received.</p> : <div className="mt-5 grid gap-2 text-left"><Textarea value={c} onChange={(e) => setC(e.target.value)} placeholder="Tell us more (optional)" aria-label="Comment" /><Button variant="primary" disabled={!c.trim()} onClick={async () => { const r = await P.rateByToken(id, tok, v, c); if (r.ok) setSent(true); }}>Send comment</Button></div>}</>
      : <><h1 className="font-display text-2xl font-bold">Couldn’t record your rating</h1><p className="mt-2 text-muted">{error}</p></>}
  </div>;
}
