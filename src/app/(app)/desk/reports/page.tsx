import { requireDeskPage } from '@/lib/auth';
import { deskCtx, ticketWhere } from '@/lib/desk-access';
import { ticketRows } from '@/lib/insights-data';
import { agentStats } from '@/lib/desk-stats';
import DeskReports from '@/components/desk/reports';

export const metadata = { title: 'Desk reports' };
export default async function DeskReportsPage({ searchParams }: { searchParams: { days?: string } }) {
  const me = await requireDeskPage(); const c = await deskCtx(me);
  const days = [7, 30, 90, 365].includes(+(searchParams.days || 0)) ? +searchParams.days! : 30;
  const [rows, stats] = await Promise.all([ticketRows(ticketWhere(c)), me.deskRole === 'light' ? Promise.resolve([]) : agentStats(c, days)]);
  return <DeskReports rows={rows} stats={stats} days={days} />;
}
