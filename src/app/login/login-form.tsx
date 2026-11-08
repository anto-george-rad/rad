'use client';
import { useState } from 'react';
import { login, loginTwoFactor, requestPasswordReset } from '@/lib/actions';
import { Button, Field, Input } from '@/components/ui';

export default function LoginForm({ next }: { next?: string }) {
  const [mode, setMode] = useState<'in' | 'forgot'>('in');
  const [email, setEmail] = useState(''); const [pw, setPw] = useState('');
  const [err, setErr] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const [token, setToken] = useState(''); const [code, setCode] = useState(''); const [useRecovery, setUseRecovery] = useState(false);
  if (token) return <>
    <h2 className="font-display text-3xl font-bold tracking-tight">Two-step sign-in</h2>
    <p className="mt-1 text-muted">{useRecovery ? 'Enter one of the recovery codes you saved when you set this up.' : 'Enter the 6-digit code from your authenticator app.'}</p>
    <form className="mt-8 flex flex-col gap-4" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(''); const r = await loginTwoFactor(token, code.trim(), next); if (r && !r.ok) { setErr(r.error); setBusy(false); if (/again/i.test(r.error) && /sign in/i.test(r.error)) { setToken(''); setCode(''); } } }}>
      <Field label={useRecovery ? 'Recovery code' : 'Code'}>{useRecovery
        ? <Input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoFocus className="num" required />
        : <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus className="num text-center text-lg tracking-[0.4em]" required />}</Field>
      {err && <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-[13px] font-medium text-bad">{err}</p>}
      <Button variant="primary" className="mt-2 h-11 text-sm" disabled={busy || (!useRecovery && code.length !== 6)}>{busy ? 'Checking…' : 'Verify'}</Button>
      <button type="button" onClick={() => { setUseRecovery(!useRecovery); setCode(''); setErr(''); }} className="text-[13px] font-semibold text-accent hover:underline">{useRecovery ? 'Use my authenticator app' : 'Lost your phone? Use a recovery code'}</button>
      <button type="button" onClick={() => { setToken(''); setCode(''); setErr(''); setPw(''); }} className="text-[13px] text-muted hover:underline">Back to sign in</button>
    </form>
  </>;
  if (mode === 'forgot') return <>
    <h2 className="font-display text-3xl font-bold tracking-tight">Reset password</h2>
    <p className="mt-1 text-muted">Enter your work email and we’ll send you a link.</p>
    <form className="mt-8 flex flex-col gap-4" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(''); const r = await requestPasswordReset(email); setBusy(false); if (r.ok) setMsg(r.message); else setErr(r.error); }}>
      <Field label="Work email"><Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
      {msg && <p role="status" className="rounded-lg bg-accent-soft px-3 py-2 text-[13px] font-medium text-accent">{msg}</p>}
      {err && <p className="rounded-lg bg-bad-soft px-3 py-2 text-[13px] font-medium text-bad">{err}</p>}
      <Button variant="primary" className="mt-2 h-11 text-sm" disabled={busy || !!msg}>{busy ? 'Sending…' : 'Send reset link'}</Button>
      <button type="button" onClick={() => { setMode('in'); setMsg(''); setErr(''); }} className="text-[13px] font-semibold text-accent hover:underline">Back to sign in</button>
    </form>
  </>;
  return <>
    <h2 className="font-display text-3xl font-bold tracking-tight">Sign in</h2>
    <p className="mt-1 text-muted">Use the account your admin created for you.</p>
    <form className="mt-8 flex flex-col gap-4" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(''); const r = await login(email, pw, next); if (r && !r.ok) { setErr(r.error); setBusy(false); } else if (r?.ok && r.twoFactor) { setToken(r.twoFactor); setBusy(false); } }}>
      <Field label="Work email"><Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
      <Field label="Password"><Input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></Field>
      {err && <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-[13px] font-medium text-bad">{err}</p>}
      <Button variant="primary" className="mt-2 h-11 text-sm" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
      <button type="button" onClick={() => { setMode('forgot'); setErr(''); }} className="text-[13px] font-semibold text-accent hover:underline">Forgot password?</button>
    </form>
  </>;
}
