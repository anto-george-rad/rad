import type { Lead, ScoringRule } from '@/db/schema';

export function scoreLead(l: Partial<Lead>, rules: ScoringRule[]) {
  let s = 0; const hits: ScoringRule[] = [];
  for (const r of rules) {
    const raw = r.field.startsWith('cf:') ? (l.custom as Record<string, unknown> | undefined)?.[r.field.slice(3)] : (l as Record<string, unknown>)[r.field];
    const v = String(raw ?? '').toLowerCase();
    let ok = false;
    if (r.operator === 'filled') ok = !!v.trim();
    else if (r.operator === 'is') ok = v === String(r.value ?? '').toLowerCase();
    else if (r.operator === 'contains') ok = String(r.value ?? '').toLowerCase().split('|').map((x) => x.trim()).filter(Boolean).some((x) => v.includes(x));
    if (ok) { s += r.points; hits.push(r); }
  }
  return { score: Math.max(0, Math.min(100, s)), hits };
}
export function scoreBand(score: number, hot: number, warm: number) { return score >= hot ? 'Hot' : score >= warm ? 'Warm' : 'Cold'; }
export const SCORE_FIELD_LABELS: Record<string, string> = { source: 'Source', jobTitle: 'Job title', companyName: 'Company', email: 'Email', phone: 'Phone', industry: 'Industry', emirate: 'Emirate', companySize: 'Company size', timeline: 'Timeline', budget: 'Budget', campaign: 'Campaign', productInterestId: 'Product of interest' };
