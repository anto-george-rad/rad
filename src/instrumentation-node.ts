export async function startNode() {
  process.env.TZ ||= process.env.APP_TIMEZONE || 'Asia/Dubai';
  if (process.env.NODE_ENV === 'production') {
    const s = process.env.AUTH_SECRET;
    if (!s || s.length < 24 || s === 'change-me-to-a-long-random-string') { console.error(JSON.stringify({ level: 'error', msg: 'AUTH_SECRET is missing or too short. Set a long random value (openssl rand -base64 48). Refusing to start.' })); process.exit(1); }
  }
  if (process.env.DISABLE_SCHEDULER === 'true' || process.env.NEXT_PHASE === 'phase-production-build') return;
  const { runScheduledJobs, runFastJobs } = await import('./lib/scheduler');
  const err = (e: unknown) => console.error(JSON.stringify({ level: 'error', msg: 'scheduler_crashed', error: String(e) }));
  const tick = () => runScheduledJobs().catch(err);
  setTimeout(tick, 60_000);            // first run a minute after start
  setInterval(tick, 60 * 60_000);      // then hourly
  setInterval(() => runFastJobs().catch(err), 2 * 60_000); // SLA timers + support mailboxes
}
