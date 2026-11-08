import 'server-only';
import { aiOn, askClaude, parseJson } from './ai';
import { getSettings } from './settings';
import { detectLanguage, heuristicCategory, heuristicPriority, heuristicSentiment } from './triage-rules';
import { PRIORITIES } from './options';

type Triage = { category?: string; priority?: string; language?: string; sentiment?: string };
/** Category, priority, language and mood for a new ticket: Claude when configured, keyword rules otherwise. */
export async function triageTicket(subject: string, body: string): Promise<Triage> {
  const s = await getSettings(); if (!s.aiTriage) return {};
  const text = `${subject}\n${body}`.slice(0, 4000);
  const fallback: Triage = { category: heuristicCategory(text, s.ticketCategories) || undefined, priority: heuristicPriority(text) || undefined, language: detectLanguage(text) || undefined, sentiment: s.aiSentiment ? heuristicSentiment(text) : undefined };
  if (!aiOn()) return clean(fallback);
  try {
    const out = parseJson<Triage>(await askClaude(`Classify this customer support request for a cybersecurity reseller.\nReturn ONLY JSON: {"category": one of ${JSON.stringify(s.ticketCategories)}, "priority": one of ${JSON.stringify(PRIORITIES)}, "language": one of ${JSON.stringify(s.ticketLanguages)}, "sentiment": "negative" | "neutral" | "positive"}.\nUse "Urgent" only for outages, security incidents or many users affected.\n\nSubject: ${subject}\n\nMessage:\n${body.slice(0, 3500)}`, { maxTokens: 120, timeoutMs: 8000 }));
    if (!out) return clean(fallback);
    return clean({ category: s.ticketCategories.includes(out.category || '') ? out.category : fallback.category, priority: PRIORITIES.includes(out.priority as never) ? out.priority : fallback.priority,
      language: s.ticketLanguages.includes(out.language || '') ? out.language : fallback.language, sentiment: s.aiSentiment && ['negative', 'neutral', 'positive'].includes(out.sentiment || '') ? out.sentiment : fallback.sentiment });
  } catch { return clean(fallback); }
}
const clean = (t: Triage) => Object.fromEntries(Object.entries(t).filter(([, v]) => v)) as Triage;
/** Mood of a customer message (for the frustrated-customer alert). */
export async function sentimentOf(body: string): Promise<'negative' | 'neutral' | 'positive' | null> {
  const s = await getSettings(); if (!s.aiSentiment) return null;
  if (!aiOn()) return heuristicSentiment(body);
  try {
    const r = (await askClaude(`Is the customer in this support message frustrated or angry? Answer with exactly one word: negative, neutral or positive.\n\n${body.slice(0, 3000)}`, { maxTokens: 5, timeoutMs: 6000 })).toLowerCase();
    return r.includes('negative') ? 'negative' : r.includes('positive') ? 'positive' : 'neutral';
  } catch { return heuristicSentiment(body); }
}
