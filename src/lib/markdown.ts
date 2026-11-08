/** A small, safe Markdown subset for help articles and replies: escapes HTML first, then formats. */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
function inline(s: string) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g, (_m, t, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`)
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_m, a, u) => `${a}<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
}
export function renderMarkdown(src: string) {
  const lines = src.replace(/\r\n/g, '\n').split('\n'); const out: string[] = []; let list: 'ul' | 'ol' | null = null; let code: string[] | null = null; let para: string[] = [];
  const flush = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const l of lines) {
    if (code) { if (/^```/.test(l)) { out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); code = null; } else code.push(l); continue; }
    if (/^```/.test(l)) { flush(); close(); code = []; continue; }
    const h = l.match(/^(#{1,3})\s+(.*)$/); if (h) { flush(); close(); out.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`); continue; }
    const ul = l.match(/^\s*[-*]\s+(.*)$/); const ol = l.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) { flush(); const k = ul ? 'ul' : 'ol'; if (list !== k) { close(); out.push(`<${k}>`); list = k; } out.push(`<li>${inline((ul || ol)![1])}</li>`); continue; }
    if (!l.trim()) { flush(); close(); continue; }
    close(); para.push(l);
  }
  if (code) out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
  flush(); close(); return out.join('\n');
}
export const plainExcerpt = (src: string, n = 180) => src.replace(/```[\s\S]*?```/g, '').replace(/[#*`>\[\]()-]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
