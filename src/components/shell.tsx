'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Activity, BarChart3, FileSignature, KeyRound, MessagesSquare, Trophy, BookOpen, Bell, Building2, CalendarCheck, ChevronDown, Clock, Filter, Headphones, Home, Inbox, KanbanSquare, LayoutDashboard, Monitor, Moon, Plus, Search, Settings, Star, Sun, Users } from 'lucide-react';
import { Avatar, Menu, Modal, ToastProvider, useToast } from './ui';
import { FormHost, useForms, type FormType } from './forms';
import { useApp } from './app-context';
import { logout, markNotificationsRead, setMyTheme, signOutEverywhere } from '@/lib/actions';
import { setAvailability } from '@/lib/desk-actions';
import { cn, timeAgo } from '@/lib/utils';
import { readRecent, type Recent } from './records';
import type { Hit } from './record-picker';

type NavItem = { href: string; label: string; icon: typeof Home; badge?: string; also?: string[]; exact?: boolean };
const CRM_NAV: NavItem[] = [
  { href: '/', label: 'Home', icon: Home, exact: true },
  { href: '/leads', label: 'Leads', icon: Filter, badge: 'leads' },
  { href: '/deals', label: 'Deals', icon: KanbanSquare },
  { href: '/contacts', label: 'Contacts', icon: Users, also: ['/companies'] },
  { href: '/activities', label: 'Activities', icon: CalendarCheck, badge: 'activities' },
  { href: '/licences', label: 'Licences', icon: KeyRound },
  { href: '/leaderboard', label: 'Leaderboard', icon: Trophy },
  { href: '/insights', label: 'Insights', icon: BarChart3 },
];
const DESK_NAV: NavItem[] = [
  { href: '/desk', label: 'Desk home', icon: LayoutDashboard, exact: true },
  { href: '/desk/tickets', label: 'Tickets', icon: Inbox, badge: 'tickets' },
  { href: '/desk/customers', label: 'Customers', icon: Building2 },
  { href: '/desk/contracts', label: 'Contracts', icon: FileSignature },
  { href: '/desk/kb', label: 'Knowledge base', icon: BookOpen },
  { href: '/desk/community', label: 'Community', icon: MessagesSquare },
  { href: '/desk/status', label: 'Status page', icon: Activity },
  { href: '/desk/leaderboard', label: 'Leaderboard', icon: Trophy },
  { href: '/desk/reports', label: 'Reports', icon: BarChart3 },
];
const SETTINGS: Record<'crm' | 'desk', NavItem> = { crm: { href: '/settings', label: 'Settings', icon: Settings }, desk: { href: '/desk/settings', label: 'Settings', icon: Settings } };
export type Module = 'crm' | 'desk';

export default function Shell({ children, badges }: { children: ReactNode; badges: Record<string, number> }) {
  return <ToastProvider><FormHost><Frame badges={badges}>{children}</Frame></FormHost></ToastProvider>;
}

/** Which module the sidebar shows: from the URL, else the last one used, limited to what this person may open. */
function useModule(): [Module, (m: Module) => void, { crm: boolean; desk: boolean }] {
  const path = usePathname(); const { me } = useApp();
  const can = { crm: me.crmAccess, desk: me.deskRole !== 'none' };
  const fromPath: Module = path.startsWith('/desk') ? 'desk' : 'crm';
  const [last, setLast] = useState<Module>(can.crm ? 'crm' : 'desk');
  useEffect(() => { try { const m = localStorage.getItem('rad-module') as Module | null; if (m && can[m]) setLast(m); } catch { /* storage off */ } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (fromPath && can[fromPath]) { setLast(fromPath); try { localStorage.setItem('rad-module', fromPath); } catch { /* storage off */ } } }, [fromPath]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = fromPath && can[fromPath] ? fromPath : can[last] ? last : can.crm ? 'crm' : 'desk';
  return [m, setLast, can];
}

function Frame({ children, badges }: { children: ReactNode; badges: Record<string, number> }) {
  const path = usePathname(); const { me, settings, favorites } = useApp(); const openForm = useForms(); const router = useRouter();
  const [palette, setPalette] = useState(false); const [keys, setKeys] = useState(false);
  const [mod, setMod, can] = useModule();
  const nav = [...(mod === 'desk' ? DESK_NAV : CRM_NAV), SETTINGS[mod]];
  const active = (n: NavItem) => n.exact ? path === n.href : path.startsWith(n.href) || (!!n.also && n.also.some((a) => path.startsWith(a)));
  useEffect(() => {
    let prefix = ''; let timer: ReturnType<typeof setTimeout> | undefined;
    const GO: Record<string, string> = can.crm ? { h: '/', l: '/leads', d: '/deals', c: '/contacts', o: '/companies', a: '/activities', i: '/insights', s: mod === 'desk' ? '/desk/settings' : '/settings', t: '/desk/tickets', k: '/desk/kb' } : { h: '/desk', t: '/desk/tickets', k: '/desk/kb', s: '/desk/settings' };
    const NEW: Record<string, FormType> = { ...(can.crm ? { l: 'lead', d: 'deal', c: 'contact', o: 'company', a: 'activity' } as Record<string, FormType> : {}), ...(can.desk && me.deskRole !== 'light' ? { t: 'ticket' } as Record<string, FormType> : {}) };
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(true); return; }
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest('input,textarea,select,[contenteditable],[role=dialog]')) return;
      const key = e.key.toLowerCase();
      if (prefix) { const p = prefix; prefix = ''; clearTimeout(timer); if (p === 'g' && GO[key] && (can.desk || !GO[key].startsWith('/desk'))) { e.preventDefault(); router.push(GO[key]); } if (p === 'n' && NEW[key]) { e.preventDefault(); openForm(NEW[key]); } return; }
      if (e.key === '/') { e.preventDefault(); setPalette(true); }
      else if (e.key === '?') { e.preventDefault(); setKeys(true); }
      else if (key === 'g' || key === 'n') { prefix = key; timer = setTimeout(() => (prefix = ''), 1200); }
    };
    window.addEventListener('keydown', k); return () => { window.removeEventListener('keydown', k); clearTimeout(timer); };
  }, [router, openForm, can.crm, can.desk, me.deskRole, mod]);
  const [recent, setRecent] = useState<Recent[]>([]);
  useEffect(() => { const r = () => setRecent(readRecent().filter((x) => x.type === 'ticket' ? can.desk : can.crm)); r(); window.addEventListener('rd-recent', r); return () => window.removeEventListener('rd-recent', r); }, [can.crm, can.desk]);
  const newItems: [string, FormType][] = [...(can.desk && me.deskRole !== 'light' ? [['Ticket', 'ticket']] as [string, FormType][] : []), ...(can.crm ? [['Lead', 'lead'], ['Deal', 'deal'], ['Contact', 'contact'], ['Company', 'company'], ['Activity', 'activity']] as [string, FormType][] : [])];
  if (mod === 'crm' && newItems[0]?.[1] === 'ticket') newItems.push(newItems.shift()!);
  const favLinks = favorites.filter((f) => f.recordType === 'ticket' ? can.desk : can.crm).map((f) => ({ id: f.recordId, label: f.label, href: f.recordType === 'ticket' ? `/desk/tickets/${f.recordId}` : `/${f.recordType === 'company' ? 'companies' : f.recordType + 's'}/${f.recordId}` }));
  return (
    <div className="grid h-dvh grid-rows-[minmax(0,1fr)_auto] md:grid-cols-[236px_minmax(0,1fr)] md:grid-rows-1">
      {/* rail */}
      <nav aria-label="Main" className="order-2 flex overflow-x-auto bg-rail px-2 pb-[max(6px,env(safe-area-inset-bottom))] pt-1.5 text-rail-ink md:order-none md:flex-col md:gap-1 md:overflow-y-auto md:px-3.5 md:py-5">
        <Link href={mod === 'desk' ? '/desk' : '/'} className="mb-4 hidden items-center gap-2.5 px-2 md:flex">
          {settings.logoDark || settings.logoLight
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={settings.logoDark || settings.logoLight} alt={settings.orgName} className="max-h-10 max-w-[180px] object-contain" />
            : <><span className="grid h-9 w-9 place-items-center rounded-[11px] bg-accent font-display text-[12px] font-extrabold tracking-tight text-accent-ink shadow-glow">RAD</span>
              <span><b className="block font-display text-[16px] leading-tight text-white">RAD Workspace</b><small className="text-[11px] text-rail-ink">{settings.orgName}</small></span></>}
        </Link>
        {can.crm && can.desk && <div role="tablist" aria-label="Module" className="mb-3 hidden grid-cols-2 gap-1 rounded-xl bg-white/[.06] p-1 md:grid">
          {([['crm', 'CRM', KanbanSquare, '/'], ['desk', 'Desk', Headphones, '/desk']] as const).map(([k, l, I, href]) => <button key={k} role="tab" aria-selected={mod === k} onClick={() => { setMod(k); router.push(href); }}
            className={cn('flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12.5px] font-semibold transition', mod === k ? 'bg-white text-[#0B0F1E]' : 'text-rail-ink hover:text-white')}><I size={14} />{l}</button>)}
        </div>}
        <div className="flex w-max min-w-full justify-between md:w-full md:flex-col md:gap-0.5">
          {can.crm && can.desk && <button onClick={() => { const n = mod === 'crm' ? 'desk' : 'crm'; setMod(n); router.push(n === 'desk' ? '/desk' : '/'); }} className="flex min-w-[64px] shrink-0 flex-1 flex-col items-center gap-0.5 rounded-[10px] px-0.5 py-1.5 text-[9.5px] font-medium md:hidden">
            {mod === 'crm' ? <Headphones size={19} strokeWidth={1.8} /> : <KanbanSquare size={19} strokeWidth={1.8} />}<span>{mod === 'crm' ? 'Desk' : 'CRM'}</span></button>}
          {nav.map((n) => {
            const on = active(n); const Icon = n.icon; const b = n.badge ? badges[n.badge] : 0;
            return <Link key={n.href} href={n.href} aria-current={on ? 'page' : undefined}
              className={cn('relative flex min-w-[64px] shrink-0 flex-1 flex-col items-center gap-0.5 rounded-[10px] px-0.5 py-1.5 text-[9.5px] font-medium transition md:flex-none md:flex-row md:gap-3 md:px-3 md:py-2.5 md:text-[13.5px]',
                on ? 'bg-white/[.09] text-white' : 'hover:bg-white/[.05] hover:text-white', n.href === '/desk/customers' && 'hidden md:flex')}>
              {on && <span className="absolute -left-3.5 top-2.5 bottom-2.5 hidden w-[3px] rounded-r bg-accent md:block" />}
              <Icon size={19} strokeWidth={1.8} />
              <span className="max-w-full truncate">{n.label}</span>
              {b > 0 && <span className="num absolute right-2 top-0.5 rounded-full bg-accent px-1.5 text-[10px] font-semibold text-accent-ink md:static md:ml-auto md:text-[11px]">{b}</span>}
            </Link>;
          })}
        </div>
        {favLinks.length > 0 && <RailList title="Favourites" icon={<Star size={12} />} items={favLinks} />}
        {recent.length > 0 && <RailList title="Recent" icon={<Clock size={12} />} items={recent.filter((r) => !favLinks.some((f) => f.id === r.id)).slice(0, 5)} />}
        <div className="mt-auto hidden items-center gap-2.5 border-t border-white/[.07] px-2 pt-4 md:flex">
          <Avatar id={me.id} name={me.name} size={28} />
          <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-semibold text-white">{me.name}</div><div className="truncate text-[11px] capitalize">{roleLabel(me)}</div></div>
        </div>
      </nav>

      {/* main */}
      <div className="flex min-h-0 min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-line bg-surface/80 px-4 py-3 backdrop-blur-xl sm:gap-3 md:px-7">
          <button onClick={() => setPalette(true)} className="flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-[10px] border border-line bg-sunken px-3 text-left text-[13px] text-faint transition hover:border-faint md:max-w-[420px]">
            <Search size={16} /><span className="flex-1 truncate">Search or jump to…</span><kbd className="num hidden rounded border border-line bg-surface px-1.5 text-[11px] text-muted sm:block">⌘K</kbd>
          </button>
          <span className="hidden flex-1 md:block" />
          {can.desk && (me.deskRole === 'agent' || me.deskRole === 'admin') && <Availability />}
          <Bell_ />
          <ThemeToggle />
          {newItems.length > 0 && <Menu trigger={(t) => <button onClick={t} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-semibold text-accent-ink shadow-glow transition hover:brightness-110 sm:px-3.5"><Plus size={16} strokeWidth={2.4} /><span className="hidden sm:inline">New</span><ChevronDown size={14} className="opacity-70" /></button>}
            items={newItems.map(([l, t]) => [l, () => openForm(t)])} />}
          <Menu trigger={(t) => <button onClick={t} aria-label="Account" className="rounded-full"><Avatar id={me.id} name={me.name} size={32} /></button>}
            items={[[`Signed in as ${me.email}`, () => {}], null, ['My account', () => router.push(mod === 'desk' ? '/desk/settings?tab=account' : '/settings?tab=account')], ['Keyboard shortcuts  ?', () => setKeys(true)], null, ['Sign out', () => logout()], ['Sign out on all devices', () => signOutEverywhere(), 'danger']]} />
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-16 pt-6 md:px-7"><div className="mx-auto max-w-[1480px] animate-rise">{children}</div></main>
      </div>
      {palette && <Palette onClose={() => setPalette(false)} can={can} />}
      <Modal open={keys} onClose={() => setKeys(false)} title="Keyboard shortcuts" sub="Press ? anywhere to open this list.">
        <div className="grid gap-x-8 gap-y-1 pb-3 sm:grid-cols-2">{SHORTCUTS.filter(([, l]) => (can.crm || !/Lead|Deal|Contact|Compan|Activit|Insight|Home/.test(l)) && (can.desk || !/Ticket|Knowledge/.test(l))).map(([k, l]) => <div key={k} className="flex items-center justify-between gap-3 border-b border-line py-2 text-[13px]"><span>{l}</span><span className="flex gap-1">{k.split(' ').map((x) => <kbd key={x} className="num rounded border border-line bg-sunken px-1.5 text-[11px]">{x}</kbd>)}</span></div>)}</div>
      </Modal>
    </div>
  );
}
const roleLabel = (me: { role: string; crmAccess: boolean; deskRole: string }) => me.role === 'admin' ? 'Admin' : [me.crmAccess ? (me.role === 'manager' ? 'Sales manager' : 'Sales') : null, me.deskRole === 'agent' ? 'Support agent' : me.deskRole === 'light' ? 'Support (read-only)' : me.deskRole === 'admin' ? 'Helpdesk admin' : null].filter(Boolean).join(' · ');

function Availability() {
  const { me } = useApp(); const [on, setOn] = useState(me.deskAvailable); const toast = useToast();
  return <button onClick={async () => { const n = !on; setOn(n); const r = await setAvailability(n); if (!r.ok) { setOn(!n); toast(r.error, 'bad'); } else toast(n ? 'You’re available for new tickets' : 'You won’t get new tickets automatically'); }}
    title={on ? 'Available: you receive auto-assigned tickets' : 'Away: auto-assignment skips you'} aria-pressed={on}
    className={cn('hidden h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold sm:inline-flex', on ? 'border-good/40 bg-good-soft text-good' : 'border-line text-muted')}>
    <span className={cn('h-2 w-2 rounded-full', on ? 'bg-good' : 'bg-faint')} />{on ? 'Available' : 'Away'}</button>;
}

const SHORTCUTS: [string, string][] = [['⌘K', 'Search and jump'], ['/', 'Search'], ['?', 'This list'], ['G H', 'Go to Home'], ['G T', 'Go to Tickets'], ['G K', 'Go to Knowledge base'], ['N T', 'New ticket'], ['G L', 'Go to Leads'], ['G D', 'Go to Deals'], ['G C', 'Go to Contacts'], ['G O', 'Go to Companies'], ['G A', 'Go to Activities'], ['G I', 'Go to Insights'], ['G S', 'Go to Settings'], ['N L', 'New lead'], ['N D', 'New deal'], ['N C', 'New contact'], ['N O', 'New company'], ['N A', 'New activity'], ['Esc', 'Close a dialog']];

function RailList({ title, icon, items }: { title: string; icon: ReactNode; items: { id: string; label: string; href: string }[] }) {
  if (!items.length) return null;
  return <div className="mt-5 hidden px-1 md:block"><div className="mb-1 flex items-center gap-1.5 px-2 text-[10.5px] font-bold uppercase tracking-wider text-rail-ink/70">{icon}{title}</div>
    {items.map((i) => <Link key={i.id} href={i.href} className="block truncate rounded-lg px-2 py-1.5 text-[12.5px] hover:bg-white/[.05] hover:text-white">{i.label}</Link>)}</div>;
}

type Notif = { id: string; title: string; body: string | null; href: string | null; readAt: string | null; createdAt: string };
function Bell_() {
  const router = useRouter(); const [open, setOpen] = useState(false); const [data, setData] = useState<{ items: Notif[]; unread: number }>({ items: [], unread: 0 }); const ref = useRef<HTMLDivElement>(null);
  const load = async () => { try { const r = await fetch('/api/notifications', { cache: 'no-store' }); if (r.ok) setData(await r.json()); } catch { /* offline */ } };
  useEffect(() => { load(); const t = setInterval(load, 60_000); const f = () => document.visibilityState === 'visible' && load(); document.addEventListener('visibilitychange', f); return () => { clearInterval(t); document.removeEventListener('visibilitychange', f); }; }, []);
  useEffect(() => { if (!open) return; const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, [open]);
  const click = async (n: Notif) => { setOpen(false); if (!n.readAt) { await markNotificationsRead([n.id]); load(); } if (n.href) router.push(n.href); };
  return <div ref={ref} className="relative">
    <button onClick={() => { setOpen((o) => !o); if (!open) load(); }} aria-label={`Notifications${data.unread ? `, ${data.unread} unread` : ''}`} title="Notifications" className="relative grid h-9 w-9 place-items-center rounded-lg text-muted transition hover:bg-sunken hover:text-ink">
      <Bell size={18} />{data.unread > 0 && <span className="num absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-bad px-1 text-[10px] font-bold text-white">{data.unread > 9 ? '9+' : data.unread}</span>}</button>
    {open && <div className="absolute right-0 top-[calc(100%+6px)] z-40 w-[min(360px,calc(100vw-24px))] overflow-hidden rounded-xl border border-line bg-surface shadow-pop animate-pop">
      <div className="flex items-center border-b border-line px-4 py-2.5"><b className="text-[13px]">Notifications</b><span className="flex-1" />{data.unread > 0 && <button className="text-xs font-semibold text-accent hover:underline" onClick={async () => { await markNotificationsRead(); load(); }}>Mark all read</button>}</div>
      <div className="max-h-[60vh] overflow-y-auto">{data.items.length ? data.items.map((n) => <button key={n.id} onClick={() => click(n)} className={cn('flex w-full gap-3 border-b border-line px-4 py-3 text-left last:border-0 hover:bg-raised', !n.readAt && 'bg-accent-soft/50')}>
        <span className={cn('mt-1.5 h-2 w-2 flex-none rounded-full', n.readAt ? 'bg-transparent' : 'bg-accent')} />
        <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold">{n.title}</span>{n.body && <span className="block truncate text-xs text-muted">{n.body}</span>}<span className="block text-[11px] text-faint">{timeAgo(n.createdAt)}</span></span></button>)
        : <p className="px-4 py-8 text-center text-[13px] text-muted">You’re all caught up.</p>}</div>
    </div>}
  </div>;
}

function ThemeToggle() {
  const { me } = useApp();
  const [mode, setMode] = useState<string>(me.theme || 'system');
  const apply = (m: string) => {
    setMode(m);
    if (m === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', m);
    try { if (m === 'system') localStorage.removeItem('rd-theme'); else localStorage.setItem('rd-theme', m); } catch { /* ignore */ }
    window.dispatchEvent(new Event('rd-theme')); setMyTheme(m as 'system');
  };
  const Icon = mode === 'dark' ? Moon : mode === 'light' ? Sun : Monitor;
  return <Menu trigger={(t) => <button onClick={t} aria-label={`Theme: ${mode}`} title="Theme" className="grid h-9 w-9 place-items-center rounded-lg text-muted transition hover:bg-sunken hover:text-ink"><Icon size={18} /></button>}
    items={[['System', () => apply('system')], ['Light', () => apply('light')], ['Dark', () => apply('dark')]].map(([l, f]) => [`${mode === String(l).toLowerCase() ? '✓ ' : '   '}${l}`, f as () => void])} />;
}

function Palette({ onClose, can }: { onClose: () => void; can: { crm: boolean; desk: boolean } }) {
  const router = useRouter(); const openForm = useForms(); const { me } = useApp();
  const [q, setQ] = useState(''); const [sel, setSel] = useState(0); const input = useRef<HTMLInputElement>(null); const [hits, setHits] = useState<Hit[]>([]);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => { if (!q.trim()) { setHits([]); return; } const t = setTimeout(async () => { try { const r = await fetch(`/api/search?type=all&limit=5&q=${encodeURIComponent(q)}`); if (r.ok) setHits((await r.json()).items); } catch { /* offline */ } }, 160); return () => clearTimeout(t); }, [q]);
  const nav: [string, string, () => void][] = [
    ...(can.crm ? [['Go to', 'Home', '/'], ['Go to', 'Leads', '/leads'], ['Go to', 'Deals', '/deals'], ['Go to', 'Contacts', '/contacts'], ['Go to', 'Companies', '/companies'], ['Go to', 'Activities', '/activities'], ['Go to', 'Insights', '/insights']] : [])
      .map(([k, l, h]) => [k, l, () => router.push(h)] as [string, string, () => void]),
    ...(can.desk ? [['Go to', 'Desk home', '/desk'], ['Go to', 'Tickets', '/desk/tickets'], ['Go to', 'Customers', '/desk/customers'], ['Go to', 'Knowledge base', '/desk/kb'], ['Go to', 'Desk reports', '/desk/reports']] : [])
      .map(([k, l, h]) => [k, l, () => router.push(h)] as [string, string, () => void]),
    ...(can.crm ? [['Go to', 'CRM settings', () => router.push('/settings')] as [string, string, () => void]] : []),
    ...(can.desk ? [['Go to', 'Helpdesk settings', () => router.push('/desk/settings')] as [string, string, () => void]] : []),
    ...(can.desk && me.deskRole !== 'light' ? [['Create', 'New ticket', () => openForm('ticket')] as [string, string, () => void]] : []),
    ...(can.crm ? ([['Create', 'New lead', 'lead'], ['Create', 'New deal', 'deal'], ['Create', 'New contact', 'contact'], ['Create', 'New company', 'company'], ['Create', 'New activity', 'activity']] as [string, string, FormType][]).map(([k, l, f]) => [k, l, () => openForm(f)] as [string, string, () => void]) : []),
  ];
  const href = (h: Hit) => h.type === 'ticket' ? `/desk/tickets/${h.id}` : (h.type === 'contact' || h.type === 'company') && !can.crm ? `/desk/customers/${h.type === 'company' ? 'c-' : ''}${h.id}` : `/${h.type === 'company' ? 'companies' : h.type + 's'}/${h.id}`;
  const s = q.trim().toLowerCase();
  const items: [string, string, () => void][] = s ? [...hits.map((h) => [h.type[0].toUpperCase() + h.type.slice(1), h.label + (h.sub ? ` · ${h.sub}` : ''), () => router.push(href(h))] as [string, string, () => void]), ...nav.filter(([, l]) => l.toLowerCase().includes(s))].slice(0, 16) : nav;
  const go = (i: number) => { const it = items[i]; if (it) { onClose(); it[2](); } };
  return <div className="fixed inset-0 z-[60] flex items-start justify-center p-3 pt-[12vh]">
    <div className="absolute inset-0 bg-[#060812]/50 backdrop-blur-[2px]" onClick={onClose} />
    <div className="relative w-full max-w-[600px] overflow-hidden rounded-2xl border border-line bg-surface shadow-pop animate-pop">
      <div className="flex items-center gap-3 border-b border-line px-4"><Search size={18} className="text-faint" />
        <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} placeholder={can.crm ? (can.desk ? 'Search tickets, deals, leads, contacts, companies…' : 'Search deals, leads, contacts, companies…') : 'Search tickets, customers…'} aria-label="Search"
          onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setSel((x) => Math.min(items.length - 1, x + 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((x) => Math.max(0, x - 1)); } else if (e.key === 'Enter') go(sel); else if (e.key === 'Escape') onClose(); }}
          className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint" />
        <kbd className="num rounded border border-line px-1.5 text-[11px] text-muted">Esc</kbd></div>
      <div className="max-h-[52vh] overflow-y-auto p-1.5">
        {items.length ? items.map(([k, l], i) => <button key={k + l + i} onMouseEnter={() => setSel(i)} onClick={() => go(i)} className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13.5px]', i === sel && 'bg-accent-soft')}>
          <span className="w-[68px] flex-none text-[11px] font-semibold text-muted">{k}</span><span className="truncate">{l}</span></button>)
          : <p className="px-3 py-8 text-center text-muted">No matches for “{q}”</p>}
      </div>
    </div>
  </div>;
}
export function PageHeader({ title, sub, actions, children }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return <div className="mb-5 flex flex-wrap items-end gap-3">
    <div className="min-w-[min(100%,280px)] flex-1"><h1 className="font-display text-[28px] font-bold leading-tight tracking-tight">{title}</h1>{sub && <p className="mt-0.5 text-[13.5px] text-muted">{sub}</p>}</div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    {children}
  </div>;
}
