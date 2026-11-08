import { and, eq, gte, sql } from 'drizzle-orm';
import { db, schema } from '@/db';

export const dynamic = 'force-dynamic';
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const fold = (l: string) => l.length <= 74 ? l : l.match(/.{1,74}/g)!.join('\r\n ');
/** Private ICS feed of one person's open CRM activities (link from My account). Token in the URL is the secret. */
export async function GET(_req: Request, { params }: { params: { file: string } }) {
  const token = params.file.replace(/\.ics$/, '');
  if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) return new Response('Not found', { status: 404 });
  const u = await db.query.users.findFirst({ where: eq(schema.users.calendarToken, token) });
  if (!u || !u.active || (!u.crmAccess && u.role !== 'admin')) return new Response('Not found', { status: 404 });
  const acts = await db.select().from(schema.activities).where(and(eq(schema.activities.ownerId, u.id), gte(schema.activities.dueDate, sql`current_date - 30`))).limit(1000);
  const tz = process.env.APP_TIMEZONE || 'Asia/Dubai'; const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//RAD Workspace//CRM//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:RAD Workspace – ${esc(u.name)}`, `X-WR-TIMEZONE:${tz}`];
  for (const a of acts) {
    if (!a.dueDate) continue; const d = a.dueDate.replace(/-/g, '');
    lines.push('BEGIN:VEVENT', `UID:${a.id}@rad.workspace`, `DTSTAMP:${stamp}`);
    if (a.dueTime && /^\d{2}:\d{2}$/.test(a.dueTime)) {
      const [h, m] = a.dueTime.split(':').map(Number); const end = h * 60 + m + (a.durationMin || 30);
      lines.push(`DTSTART;TZID=${tz}:${d}T${a.dueTime.replace(':', '')}00`, `DTEND;TZID=${tz}:${d}T${String(Math.min(23, Math.floor(end / 60))).padStart(2, '0')}${String(end % 60).padStart(2, '0')}00`);
    } else lines.push(`DTSTART;VALUE=DATE:${d}`);
    lines.push(fold(`SUMMARY:${esc((a.done ? '✓ ' : '') + a.title)}`));
    if (a.location) lines.push(fold(`LOCATION:${esc(a.location)}`));
    if (a.details) lines.push(fold(`DESCRIPTION:${esc(a.details)}`));
    if (a.done) lines.push('STATUS:COMPLETED'); lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return new Response(lines.join('\r\n'), { headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'private, max-age=300' } });
}
