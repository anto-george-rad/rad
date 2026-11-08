/** Structured one-line JSON logs on stdout/stderr (read them with `docker compose logs app`). */
const out = (level: string, msg: string, data?: Record<string, unknown>) => {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...data });
  if (level === 'error') console.error(line); else console.log(line);
};
export const log = {
  info: (msg: string, data?: Record<string, unknown>) => out('info', msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => out('warn', msg, data),
  error: (msg: string, data?: Record<string, unknown>) => out('error', msg, data),
};
