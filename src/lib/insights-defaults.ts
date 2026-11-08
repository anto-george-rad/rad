export type Visual = 'kpi' | 'column' | 'bar' | 'stacked' | 'line' | 'area' | 'donut' | 'funnel' | 'table';
export type TileFilter = { dim: string; op: 'is' | 'not'; value: string };
export type Tile = {
  id: string; title?: string; ds: 'deals' | 'leads' | 'activities' | 'contacts' | 'companies' | 'tickets';
  visual: Visual; measure: string; groupBy?: string; seriesBy?: string; dateField?: string;
  filters?: TileFilter[]; topN?: number; size?: 's' | 'm' | 'l'; months?: number;
};
let n = 0; const T = (o: Omit<Tile, 'id'>): Tile => ({ id: `t${++n}`, size: 'm', filters: [], ...o });

/** Built-in helpdesk report page (Desk → Reports). */
export function deskTiles(): Tile[] {
  n = 0;
  return [
    T({ ds: 'tickets', visual: 'kpi', measure: 'count', size: 's', title: 'Tickets created' }),
    T({ ds: 'tickets', visual: 'kpi', measure: 'frt', size: 's', title: 'Avg first response (h)' }),
    T({ ds: 'tickets', visual: 'kpi', measure: 'sla', size: 's', title: 'SLA met' }),
    T({ ds: 'tickets', visual: 'kpi', measure: 'csat', size: 's', title: 'Customer satisfaction' }),
    T({ ds: 'tickets', visual: 'stacked', measure: 'count', groupBy: 'createdMonth', seriesBy: 'status', size: 'l', title: 'Tickets per month by status' }),
    T({ ds: 'tickets', visual: 'bar', measure: 'count', groupBy: 'assignee', dateField: 'none', filters: [{ dim: 'status', op: 'not', value: 'Closed' }], title: 'Open tickets by assignee' }),
    T({ ds: 'tickets', visual: 'donut', measure: 'count', groupBy: 'priority', dateField: 'none', filters: [{ dim: 'status', op: 'not', value: 'Closed' }], title: 'Open tickets by priority' }),
    T({ ds: 'tickets', visual: 'column', measure: 'count', groupBy: 'channel', title: 'Tickets by channel' }),
    T({ ds: 'tickets', visual: 'bar', measure: 'count', groupBy: 'category', title: 'Tickets by category' }),
    T({ ds: 'tickets', visual: 'bar', measure: 'art', groupBy: 'department', title: 'Avg resolution by department (h)' }),
    T({ ds: 'tickets', visual: 'donut', measure: 'count', groupBy: 'sla', dateField: 'resolvedAt', title: 'SLA outcome' }),
    T({ ds: 'tickets', visual: 'bar', measure: 'count', groupBy: 'company', topN: 8, title: 'Top customers by tickets' }),
    T({ ds: 'tickets', visual: 'donut', measure: 'count', groupBy: 'rating', dateField: 'resolvedAt', filters: [{ dim: 'rating', op: 'not', value: 'Not rated' }], title: 'Satisfaction ratings' }),
    T({ ds: 'tickets', visual: 'table', measure: 'count', groupBy: 'product', title: 'Tickets by product' }),
  ];
}
export function defaultPages(): { name: string; tiles: Tile[] }[] {
  n = 0;
  return [
    { name: 'Sales overview', tiles: [
      T({ ds: 'deals', visual: 'kpi', measure: 'sum', dateField: 'none', filters: [{ dim: 'status', op: 'is', value: 'Open' }], size: 's', title: 'Open pipeline' }),
      T({ ds: 'deals', visual: 'kpi', measure: 'sum', dateField: 'closedAt', filters: [{ dim: 'status', op: 'is', value: 'Won' }], size: 's', title: 'Won revenue' }),
      T({ ds: 'deals', visual: 'kpi', measure: 'winRate', dateField: 'closedAt', size: 's', title: 'Win rate' }),
      T({ ds: 'deals', visual: 'kpi', measure: 'avg', dateField: 'closedAt', filters: [{ dim: 'status', op: 'is', value: 'Won' }], size: 's', title: 'Average won deal' }),
      T({ ds: 'deals', visual: 'column', measure: 'sum', groupBy: 'stage', dateField: 'none', filters: [{ dim: 'status', op: 'is', value: 'Open' }], topN: 0, title: 'Open pipeline by stage' }),
      T({ ds: 'deals', visual: 'area', measure: 'sum', groupBy: 'closedMonth', dateField: 'closedAt', filters: [{ dim: 'status', op: 'is', value: 'Won' }], title: 'Won revenue by month' }),
      T({ ds: 'deals', visual: 'donut', measure: 'sum', groupBy: 'owner', dateField: 'none', filters: [{ dim: 'status', op: 'is', value: 'Open' }], title: 'Open pipeline by owner' }),
      T({ ds: 'deals', visual: 'bar', measure: 'sum', groupBy: 'company', dateField: 'none', filters: [{ dim: 'status', op: 'is', value: 'Open' }], topN: 8, title: 'Top accounts by open value' }),
      T({ ds: 'deals', visual: 'funnel', measure: 'count', groupBy: 'stage', dateField: 'createdAt', filters: [{ dim: 'pipeline', op: 'is', value: 'Sales' }, { dim: 'status', op: 'not', value: 'Lost' }], topN: 0, title: 'Sales funnel' }),
      T({ ds: 'deals', visual: 'donut', measure: 'count', groupBy: 'lossReason', dateField: 'closedAt', filters: [{ dim: 'status', op: 'is', value: 'Lost' }], title: 'Why we lose' }),
      T({ ds: 'deals', visual: 'stacked', measure: 'count', groupBy: 'createdMonth', seriesBy: 'status', dateField: 'createdAt', size: 'l', title: 'Deals created per month by outcome' }),
    ] },
    { name: 'Partners', tiles: [
      T({ ds: 'deals', visual: 'bar', measure: 'sum', groupBy: 'distributor', dateField: 'none', filters: [{ dim: 'status', op: 'is', value: 'Open' }], topN: 8, title: 'Open pipeline by distributor' }),
      T({ ds: 'deals', visual: 'bar', measure: 'sum', groupBy: 'distributor', dateField: 'closedAt', filters: [{ dim: 'status', op: 'is', value: 'Won' }], topN: 8, title: 'Won revenue by distributor' }),
      T({ ds: 'deals', visual: 'bar', measure: 'winRate', groupBy: 'distributor', dateField: 'closedAt', topN: 8, title: 'Win rate by distributor' }),
      T({ ds: 'deals', visual: 'bar', measure: 'sum', groupBy: 'reseller', dateField: 'none', filters: [{ dim: 'status', op: 'is', value: 'Open' }], topN: 8, title: 'Open pipeline by reseller' }),
      T({ ds: 'deals', visual: 'stacked', measure: 'sum', groupBy: 'closingMonth', seriesBy: 'forecast', dateField: 'none', filters: [{ dim: 'status', op: 'is', value: 'Open' }], size: 'l', title: 'Forecast by category and closing month' }),
    ] },
    { name: 'Leads', tiles: [
      T({ ds: 'leads', visual: 'kpi', measure: 'count', size: 's', title: 'New leads' }),
      T({ ds: 'leads', visual: 'kpi', measure: 'conv', size: 's', title: 'Lead conversion' }),
      T({ ds: 'leads', visual: 'kpi', measure: 'avgScore', size: 's', title: 'Average lead score' }),
      T({ ds: 'leads', visual: 'kpi', measure: 'count', filters: [{ dim: 'score', op: 'is', value: 'Hot' }], size: 's', title: 'Hot leads' }),
      T({ ds: 'leads', visual: 'donut', measure: 'count', groupBy: 'source', title: 'Leads by source' }),
      T({ ds: 'leads', visual: 'column', measure: 'count', groupBy: 'status', title: 'Leads by status' }),
      T({ ds: 'leads', visual: 'stacked', measure: 'count', groupBy: 'source', seriesBy: 'score', title: 'Lead quality by source' }),
      T({ ds: 'leads', visual: 'table', measure: 'conv', groupBy: 'source', title: 'Conversion by source' }),
    ] },
    { name: 'Team activity', tiles: [
      T({ ds: 'activities', visual: 'kpi', measure: 'count', dateField: 'none', filters: [{ dim: 'status', op: 'is', value: 'Open' }], size: 's', title: 'Open activities' }),
      T({ ds: 'activities', visual: 'kpi', measure: 'count', dateField: 'none', filters: [{ dim: 'status', op: 'is', value: 'Overdue' }], size: 's', title: 'Overdue' }),
      T({ ds: 'deals', visual: 'kpi', measure: 'cycle', dateField: 'closedAt', size: 's', title: 'Days to win' }),
      T({ ds: 'deals', visual: 'kpi', measure: 'weighted', dateField: 'none', filters: [{ dim: 'status', op: 'is', value: 'Open' }], size: 's', title: 'Weighted forecast' }),
      T({ ds: 'activities', visual: 'stacked', measure: 'count', groupBy: 'owner', seriesBy: 'status', dateField: 'none', title: 'Workload by owner' }),
      T({ ds: 'activities', visual: 'bar', measure: 'count', groupBy: 'type', dateField: 'due', title: 'Activities by type' }),
      T({ ds: 'deals', visual: 'table', measure: 'sum', groupBy: 'owner', seriesBy: 'status', dateField: 'none', size: 'l', title: 'Pipeline by owner and outcome' }),
    ] },
  ];
}
