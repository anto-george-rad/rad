import { requireDeskPage } from '@/lib/auth';
import { agentLeaderboard, type Period } from '@/lib/leaderboard';
import { AgentLeaderboard } from '@/components/leaderboard';

export const metadata = { title: 'Agent leaderboard' };
const OK: Period[] = ['month', 'last_month', 'quarter', 'year'];
export default async function Page({ searchParams }: { searchParams: { period?: string } }) {
  const me = await requireDeskPage(); const period = (OK.includes(searchParams.period as Period) ? searchParams.period : 'month') as Period;
  const { rows, label } = await agentLeaderboard(period);
  return <AgentLeaderboard rows={rows} period={period} label={label} meId={me.id} />;
}
