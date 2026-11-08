import { notFound } from 'next/navigation';
import { getSettings } from '@/lib/settings';
import { requirePortalUser } from '@/lib/portal-auth';
import { NewTopic } from '@/components/community';

export const metadata = { title: 'Ask the community' };
export default async function Page() {
  const s = await getSettings(); if (!s.communityEnabled) notFound(); await requirePortalUser();
  return <NewTopic categories={s.forumCategories} />;
}
