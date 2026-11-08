import { notFound } from 'next/navigation';
import { requireDeskPage } from '@/lib/auth';
import { topic } from '@/lib/community-data';
import { TopicView } from '@/components/community';

export const metadata = { title: 'Community' };
export default async function Page({ params }: { params: { id: string } }) {
  await requireDeskPage(); const x = await topic(params.id, true, null, false); if (!x) notFound();
  return <TopicView t={x.t} posts={x.posts} mode="desk" signedIn />;
}
