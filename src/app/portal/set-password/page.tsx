import { PortalSetPassword } from '@/components/portal';
export const metadata = { title: 'Choose a password' };
export default function Page({ searchParams }: { searchParams: { token?: string } }) { return <PortalSetPassword token={searchParams.token || ''} />; }
