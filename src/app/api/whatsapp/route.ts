import { getIntegrations, getSettings } from '@/lib/settings';
import { open as openSecret } from '@/lib/crypto-box';
import { handleInbound, validSignature } from '@/lib/whatsapp';
import { log } from '@/lib/log';

export const dynamic = 'force-dynamic';
/** Meta's webhook verification handshake. */
export async function GET(req: Request) {
  const u = new URL(req.url); const cfg = (await getIntegrations()).whatsapp;
  if (u.searchParams.get('hub.mode') === 'subscribe' && cfg?.verifyToken && u.searchParams.get('hub.verify_token') === cfg.verifyToken) return new Response(u.searchParams.get('hub.challenge') || '', { status: 200 });
  return new Response('Forbidden', { status: 403 });
}
/** Incoming messages: signature checked with the app secret, then turned into tickets. Always 200 quickly so Meta doesn't retry storms. */
export async function POST(req: Request) {
  const raw = await req.text(); const s = await getSettings(); const cfg = (await getIntegrations()).whatsapp;
  if (!s.whatsappEnabled || !cfg?.appSecret) return new Response('Not enabled', { status: 404 });
  if (!validSignature(raw, req.headers.get('x-hub-signature-256'), openSecret(cfg.appSecret))) return new Response('Bad signature', { status: 401 });
  try { await handleInbound(JSON.parse(raw)); } catch (e) { log.error('wa_inbound_failed', { error: String(e) }); }
  return new Response('ok', { status: 200 });
}
