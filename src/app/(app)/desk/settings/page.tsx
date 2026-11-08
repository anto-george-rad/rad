import { requireDeskPage } from '@/lib/auth';
import SettingsScreen from '../../settings/screen';

export const metadata = { title: 'Helpdesk settings' };
export default async function DeskSettingsPage({ searchParams }: { searchParams: { tab?: string; audit?: string } }) {
  const me = await requireDeskPage();
  return <SettingsScreen me={me} module="desk" searchParams={searchParams} />;
}
