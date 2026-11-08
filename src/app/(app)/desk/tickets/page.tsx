import { requireDeskPage } from '@/lib/auth';
import { deskCtx } from '@/lib/desk-access';
import { listTickets, viewCounts, type ListArgs } from '@/lib/ticket-list';
import { viewsFor } from '@/lib/list-query';
import TicketsView from '@/components/desk/tickets';

export const metadata = { title: 'Tickets' };
export default async function TicketsPage({ searchParams }: { searchParams: ListArgs }) {
  const me = await requireDeskPage(); const c = await deskCtx(me);
  const [list, counts, views] = await Promise.all([listTickets(c, searchParams), viewCounts(c), viewsFor(me.id, 'tickets')]);
  return <TicketsView {...list} counts={counts} views={views} />;
}
