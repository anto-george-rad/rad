import { requireCrmPage } from '@/lib/auth';
import { salesLeaderboard, type Period } from '@/lib/leaderboard';
import { SalesLeaderboard } from '@/components/leaderboard';

export const metadata = { title: 'Sales leaderboard' };
const OK: Period[] = ['month', 'last_month', 'quarter', 'year'];
export default async function Page({ searchParams }: { searchParams: { period?: string } }) {
  const me = await requireCrmPage(); const period = (OK.includes(searchParams.period as Period) ? searchParams.period : 'month') as Period;
  const { rows, label } = await salesLeaderboard(period);
  return <SalesLeaderboard rows={rows} period={period} label={label} meId={me.id} />;
}
