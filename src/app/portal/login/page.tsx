import { redirect } from 'next/navigation';
import { getPortalUser } from '@/lib/portal-auth';
import { PortalLogin } from '@/components/portal';
export const metadata = { title: 'Sign in' };
export default async function Page() { if (await getPortalUser()) redirect('/portal/tickets'); return <PortalLogin />; }
