import 'server-only';

export const aiOn = () => !!process.env.ANTHROPIC_API_KEY;
/** One Claude call with a timeout. Throws a readable error when AI isn't set up or the call fails. */
export async function askClaude(prompt: string, opts: { maxTokens?: number; timeoutMs?: number; system?: string } = {}) {
  const key = process.env.ANTHROPIC_API_KEY; if (!key) throw new Error('The AI assistant is not set up. Add ANTHROPIC_API_KEY to the server environment.');
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 20_000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: opts.maxTokens ?? 600, ...(opts.system ? { system: opts.system } : {}), messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) throw new Error(`The AI service returned an error (${res.status}).`);
    const j = await res.json() as { content?: { type: string; text?: string }[] };
    return (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
  } finally { clearTimeout(timer); }
}
/** Pulls the first JSON object out of a model reply. */
export function parseJson<T>(text: string): T | null { const m = text.match(/\{[\s\S]*\}/); if (!m) return null; try { return JSON.parse(m[0]) as T; } catch { return null; } }
