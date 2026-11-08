'use client';
import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Download } from 'lucide-react';
import type { TicketDS } from '@/lib/insights-data';
import { deskTiles } from '@/lib/insights-defaults';
import { Button, Panel, Segmented } from '../ui';
import { useApp } from '../app-context';
import { PageHeader } from '../shell';
import { aggregate, autoTitle, sources, type Ctx } from '../insights/engine';
import { TileBody } from '../insights/tile-view';
import { useColorIdx } from '../insights/insights';
import { cn } from '@/lib/utils';
import { AgentTable, deskDS } from './home';

export default function DeskReports({ rows, stats, days }: { rows: TicketDS[]; stats: Parameters<typeof AgentTable>[0]['stats']; days: number }) {
  const router = useRouter(); const { me } = useApp();
  const data = useMemo(() => deskDS(rows), [rows]); const S = useMemo(() => sources(data), [data]); const colorIdx = useColorIdx(S, data);
  const ctx: Ctx = useMemo(() => ({ range: [Date.now() - days * 86_400_000, Date.now()], mine: null, pipe: '', cross: [] }), [days]);
  const tiles = useMemo(() => deskTiles(), []);
  return <>
    <PageHeader title="Desk reports" sub={`Tickets you can see, last ${days} days. Open-ticket charts show today’s backlog.`}
      actions={<><Segmented value={String(days)} onChange={(v) => router.replace(`/desk/reports?days=${v}`)} options={[['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['365', '12 months']]} />{me.role !== 'rep' && me.deskRole !== 'light' && <a href="/api/export/tickets"><Button><Download size={15} />Export</Button></a>}</>} />
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.filter((t) => t.visual === 'kpi').map((t) => <Panel key={t.id} bodyClass="p-0"><TileBody t={t} agg={aggregate(S, data, t, ctx)} ctx={ctx} colorIdx={colorIdx} /></Panel>)}
    </div>
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      {tiles.filter((t) => t.visual !== 'kpi').map((t) => <Panel key={t.id} title={t.title || autoTitle(S, t)} className={cn(t.size === 'l' && 'lg:col-span-2')} bodyClass="p-5"><TileBody t={t} agg={aggregate(S, data, t, t.dateField === 'none' ? { ...ctx, range: null } : ctx)} ctx={ctx} colorIdx={colorIdx} /></Panel>)}
    </div>
    {stats.length > 0 && <div className="mt-4"><AgentTable stats={stats} days={days} /></div>}
  </>;
}
