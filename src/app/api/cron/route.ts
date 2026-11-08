import { runFastJobs, runScheduledJobs } from '@/lib/scheduler';
import { getUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';
/** Run the hourly jobs now: with "Authorization: Bearer $CRON_SECRET", or as a signed-in admin. */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const ok = (secret && bearer === secret) || (await getUser())?.role === 'admin';
  if (!ok) return Response.json({ error: 'Not allowed.' }, { status: 401 });
  return Response.json({ ok: true, ran: await runScheduledJobs(), fast: await runFastJobs() });
}
export const GET = handle; export const POST = handle;
