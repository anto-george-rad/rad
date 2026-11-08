'use client';
import Link from 'next/link';
import { useState } from 'react';
import { resetPassword } from '@/lib/actions';
import { Button, Field, Input } from '@/components/ui';
import { passwordProblem } from '@/lib/utils';

export default function ResetForm({ token }: { token: string }) {
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  if (!token) return <><h2 className="font-display text-3xl font-bold tracking-tight">Link missing</h2><p className="mt-2 text-muted">Open the reset link from your email, or ask your admin for a new one.</p><Link href="/login" className="mt-6 inline-block text-[13px] font-semibold text-accent hover:underline">Back to sign in</Link></>;
  if (done) return <><h2 className="font-display text-3xl font-bold tracking-tight">Password changed</h2><p className="mt-2 text-muted">You’ve been signed out everywhere else. Sign in with your new password.</p><Link href="/login"><Button variant="primary" className="mt-6 h-11 w-full text-sm">Sign in</Button></Link></>;
  return <>
    <h2 className="font-display text-3xl font-bold tracking-tight">Choose a new password</h2>
    <p className="mt-1 text-muted">At least 10 characters, with letters and numbers.</p>
    <form className="mt-8 flex flex-col gap-4" onSubmit={async (e) => { e.preventDefault(); setErr(''); const p = passwordProblem(pw); if (p) return setErr(p); if (pw !== pw2) return setErr('The two passwords don’t match.'); setBusy(true); const r = await resetPassword(token, pw); setBusy(false); if (!r.ok) setErr(r.error); else setDone(true); }}>
      <Field label="New password"><Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus /></Field>
      <Field label="Repeat it"><Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required /></Field>
      {err && <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-[13px] font-medium text-bad">{err}</p>}
      <Button variant="primary" className="mt-2 h-11 text-sm" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</Button>
    </form>
  </>;
}
