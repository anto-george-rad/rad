import { requireDeskPage } from '@/lib/auth';
/** Every /desk page needs a helpdesk role. */
export default async function DeskLayout({ children }: { children: React.ReactNode }) { await requireDeskPage(); return <>{children}</>; }
