import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

/** Same rule as authSecret() in lib/auth (the edge runtime can't import server-only modules). */
function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 24 || s === 'change-me-to-a-long-random-string') return process.env.NODE_ENV === 'production' ? null : new TextEncoder().encode('dev-only-secret-not-for-production-use');
  return new TextEncoder().encode(s);
}
const PUBLIC = ['/api/forms', '/forms', '/api/whatsapp', '/status', '/login', '/reset', '/api/health', '/api/brand', '/api/cron', '/portal', '/support', '/rate', '/api/portal', '/api/calendar', '/manifest.webmanifest', '/app-icon.svg'];
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + '/') || pathname.startsWith(p + '?'))) return NextResponse.next();
  const token = req.cookies.get('rd_session')?.value; const key = secret();
  if (token && key) {
    try { await jwtVerify(token, key); return NextResponse.next(); } catch { /* fall through */ }
  }
  if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const url = req.nextUrl.clone(); url.pathname = '/login'; url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'] };
