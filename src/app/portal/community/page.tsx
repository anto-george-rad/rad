import { notFound } from 'next/navigation';
import { getSettings } from '@/lib/settings';
import { getPortalUser } from '@/lib/portal-auth';
import { topics } from '@/lib/community-data';
import { TopicList } from '@/components/community';

export const metadata = { title: 'Community' };
export default async function Page({ searchParams }: { searchParams: { cat?: string; q?: string } }) {
  const s = await getSettings(); if (!s.communityEnabled) notFound();
  const me = await getPortalUser();
  return <TopicList topics={await topics({ cat: searchParams.cat, q: searchParams.q, includeHidden: false })} categories={s.forumCategories} base="/portal/community" cat={searchParams.cat || ''} q={searchParams.q || ''} canPost={!!me} />;
}
