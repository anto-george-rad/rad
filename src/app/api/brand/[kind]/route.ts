import { getSettings } from '@/lib/settings';

/** Public brand assets: /api/brand/light, /api/brand/dark (uploaded logos) and /api/brand/icon (favicon). */
export async function GET(_req: Request, { params }: { params: { kind: string } }) {
  const s = await getSettings();
  const data = params.kind === 'dark' ? s.logoDark || s.logoLight : params.kind === 'light' ? s.logoLight || s.logoDark : s.logoLight || s.logoDark;
  if (data) {
    const m = data.match(/^data:(image\/[\w+.-]+);base64,(.*)$/);
    if (m) return new Response(Buffer.from(m[2], 'base64'), { headers: { 'content-type': m[1], 'cache-control': 'public, max-age=300', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" } });
  }
  if (params.kind === 'icon') return Response.redirect(new URL('/icon.svg', _req.url), 302);
  return new Response('Not found', { status: 404 });
}
