import { headers } from 'next/headers';
import { corsHeaders, submitLead, type LeadFormInput } from '@/lib/lead-form';

export const dynamic = 'force-dynamic';
const ipOf = () => (headers().get('x-forwarded-for') || headers().get('x-real-ip') || 'local').split(',')[0].trim();
export async function OPTIONS(req: Request) { return new Response(null, { status: 204, headers: await corsHeaders(req.headers.get('origin')) }); }
/** Web-to-lead: JSON (from a script on raidefend.com) or a plain HTML form post (redirects back with ?sent=1). */
export async function POST(req: Request) {
  const cors = await corsHeaders(req.headers.get('origin')); const type = req.headers.get('content-type') || '';
  let f: LeadFormInput = {}; let redirectTo: string | null = null;
  try {
    if (type.includes('application/json')) f = await req.json();
    else { const fd = await req.formData(); f = Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)])); redirectTo = (f as Record<string, string>).redirect || null; }
  } catch { return Response.json({ ok: false, message: 'The form could not be read.' }, { status: 400, headers: cors }); }
  const r = await submitLead(f, ipOf());
  if (redirectTo && /^https?:\/\//.test(redirectTo)) { const u = new URL(redirectTo); u.searchParams.set(r.ok ? 'sent' : 'error', r.ok ? '1' : r.message); return Response.redirect(u.toString(), 303); }
  return Response.json({ ok: r.ok, message: r.message }, { status: r.status, headers: cors });
}
