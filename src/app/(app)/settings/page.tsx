import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import SettingsScreen from './screen';

export const metadata = { title: 'CRM settings' };
export default async function CrmSettingsPage({ searchParams }: { searchParams: { tab?: string; audit?: string } }) {
  const me = await requireUser();
  // Helpdesk-only people have their own settings under the helpdesk.
  if (!me.crmAccess && me.deskRole !== 'none') redirect(`/desk/settings${searchParams.tab ? `?tab=${encodeURIComponent(searchParams.tab)}` : ''}`);
  return <SettingsScreen me={me} module="crm" searchParams={me.crmAccess ? searchParams : { tab: 'account' }} />;
}
