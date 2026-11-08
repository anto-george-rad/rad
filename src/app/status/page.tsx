import { notFound } from 'next/navigation';
import { getSettings } from '@/lib/settings';
import { activeIncidents } from '@/lib/community-data';
import { PublicStatus } from '@/components/status-page';

export const dynamic = 'force-dynamic';
export async function generateMetadata() { const s = await getSettings(); return { title: `System status · ${s.portalTitle}` }; }
export default async function StatusPage() {
  const s = await getSettings(); if (!s.statusPageEnabled) notFound();
  return <div className="min-h-dvh bg-bg px-4 py-10"><PublicStatus title={s.portalTitle} components={s.statusComponents} incidents={await activeIncidents()} />
    <p className="mx-auto mt-8 max-w-3xl text-xs text-faint"><a href="/portal" className="hover:underline">{s.portalTitle}</a> · {s.orgName}</p></div>;
}
