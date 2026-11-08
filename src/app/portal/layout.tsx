import Link from 'next/link';
import { getPortalUser } from '@/lib/portal-auth';
import { getSettings } from '@/lib/settings';
import { ToastProvider } from '@/components/ui';
import { PortalSignOut } from '@/components/portal';
import { IncidentBanner } from '@/components/status-page';
import { activeIncidents } from '@/lib/community-data';

export const dynamic = 'force-dynamic';
export async function generateMetadata() { const s = await getSettings(); return { title: { default: s.portalTitle, template: `%s · ${s.portalTitle}` } }; }
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const [me, s, incidents] = await Promise.all([getPortalUser(), getSettings(), activeIncidents()]);
  return <ToastProvider><div className="min-h-dvh bg-bg">
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3 md:px-6">
        <Link href="/portal" className="flex items-center gap-2.5">
          {s.logoLight || s.logoDark
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src="/api/brand/light" alt={s.orgName} className="max-h-9 max-w-[160px] object-contain" />
            : <span className="grid h-9 w-9 place-items-center rounded-[11px] bg-accent font-display text-[12px] font-extrabold text-accent-ink">RAD</span>}
          <b className="font-display text-[16px]">{s.portalTitle}</b></Link>
        <span className="flex-1" />
        <nav className="flex flex-wrap items-center gap-1 text-[13.5px] font-semibold">
          <Link className="rounded-lg px-3 py-2 text-muted hover:bg-sunken hover:text-ink" href="/portal/kb">Help articles</Link>
          {s.communityEnabled && <Link className="rounded-lg px-3 py-2 text-muted hover:bg-sunken hover:text-ink" href="/portal/community">Community</Link>}
          {s.statusPageEnabled && <Link className="rounded-lg px-3 py-2 text-muted hover:bg-sunken hover:text-ink" href="/status">Status</Link>}
          {me && <Link className="rounded-lg px-3 py-2 text-muted hover:bg-sunken hover:text-ink" href="/portal/tickets">My requests</Link>}
          <Link className="rounded-lg bg-accent px-3 py-2 text-accent-ink hover:brightness-110" href="/portal/new">Submit a request</Link>
          {me ? <PortalSignOut name={me.firstName} /> : <Link className="rounded-lg px-3 py-2 text-muted hover:bg-sunken hover:text-ink" href="/portal/login">Sign in</Link>}
        </nav>
      </div>
    </header>
    <IncidentBanner incidents={incidents.filter((i) => i.kind === 'incident' || +i.startsAt - Date.now() < 3 * 864e5)} />
    <main className="mx-auto max-w-5xl px-4 py-8 md:px-6">{children}</main>
    <footer className="mx-auto max-w-5xl px-4 pb-10 text-xs text-faint md:px-6">{s.orgName}{s.phone ? ` · ${s.phone}` : ''}{s.email ? ` · ${s.email}` : ''}</footer>
  </div></ToastProvider>;
}
