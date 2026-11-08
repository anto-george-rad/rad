import { requireDeskPage } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { topics } from '@/lib/community-data';
import { TopicList } from '@/components/community';

export const metadata = { title: 'Community' };
export default async function Page({ searchParams }: { searchParams: { cat?: string; q?: string } }) {
  await requireDeskPage(); const s = await getSettings();
  return <TopicList topics={await topics({ cat: searchParams.cat, q: searchParams.q, includeHidden: true })} categories={s.forumCategories} base="/desk/community" cat={searchParams.cat || ''} q={searchParams.q || ''} canPost={false} />;
}
