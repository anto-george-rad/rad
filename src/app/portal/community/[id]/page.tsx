import { notFound } from 'next/navigation';
import { getSettings } from '@/lib/settings';
import { getPortalUser } from '@/lib/portal-auth';
import { topic } from '@/lib/community-data';
import { TopicView } from '@/components/community';

export const metadata = { title: 'Community' };
export default async function Page({ params }: { params: { id: string } }) {
  const s = await getSettings(); if (!s.communityEnabled) notFound();
  const me = await getPortalUser(); const x = await topic(params.id, false, me?.id || null, true); if (!x) notFound();
  return <TopicView t={x.t} posts={x.posts} mode="portal" signedIn={!!me} />;
}
