import { getSettings } from '@/lib/settings';

/** Left half of the sign-in and reset pages, using the branding set in Settings → Branding. */
export async function BrandPanel() {
  const s = await getSettings();
  const bg = s.loginBackground;
  return <section className="relative hidden overflow-hidden bg-rail p-12 text-white lg:flex lg:flex-col">
    {bg === 'mesh' && <><div className="absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full bg-accent opacity-30 blur-[120px]" /><div className="absolute -bottom-32 right-0 h-[360px] w-[360px] rounded-full bg-[#1BAF7A] opacity-15 blur-[110px]" /></>}
    {bg === 'grid' && <div className="absolute inset-0 opacity-[.07]" style={{ backgroundImage: 'linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px)', backgroundSize: '44px 44px' }} />}
    <div className="relative"><BrandMark name={s.orgName} logo={s.logoDark || s.logoLight ? '/api/brand/dark' : ''} light /></div>
    <div className="relative mt-auto max-w-lg">
      <p className="eyebrow !text-[#8C94B8]">Customer workspace</p>
      <h1 className="mt-3 text-balance font-display text-5xl font-bold leading-[1.02] tracking-tight">{s.loginHeadline}</h1>
      {s.loginSubtext && <p className="mt-4 text-[15px] text-[#A3AAC8]">{s.loginSubtext}</p>}
      <ul className="mt-10 grid gap-2.5 text-[14px] text-[#C7CCE2]">
        {['Pipelines with stage rules and win/loss reasons', 'Automations and reminders that follow up for you', 'Reports you build yourself, scoped to your team'].map((t) => <li key={t} className="flex items-center gap-2.5"><span className="h-1.5 w-1.5 rounded-full bg-accent" />{t}</li>)}
      </ul>
    </div>
  </section>;
}
export async function MobileMark() {
  const s = await getSettings();
  return <div className="mb-8 lg:hidden"><BrandMark name={s.orgName} logo={s.logoLight || s.logoDark ? '/api/brand/light' : ''} /></div>;
}
function BrandMark({ name, logo, light }: { name: string; logo: string; light?: boolean }) {
  // eslint-disable-next-line @next/next/no-img-element
  if (logo) return <img src={logo} alt={name} className="max-h-11 max-w-[200px] object-contain" />;
  return <span className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-accent shadow-glow"><svg width="20" height="20" viewBox="0 0 32 32"><path d="M11 8h6.6a4.4 4.4 0 0 1 1.1 8.7L22.4 24h-3.6l-3.4-6.6H14V24h-3V8Zm3 2.9v3.7h3.5a1.85 1.85 0 0 0 0-3.7H14Z" fill="currentColor" className="text-accent-ink" /></svg></span>
    <span className={`font-display text-xl font-bold tracking-tight ${light ? 'text-white' : ''}`}>{name}</span></span>;
}
