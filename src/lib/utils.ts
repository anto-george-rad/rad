import clsx, { type ClassValue } from 'clsx';
export const cn = (...c: ClassValue[]) => clsx(c);

export const DAY = 86_400_000;
/** Company timezone on the server (APP_TIMEZONE, default Asia/Dubai); the browser's own zone on the client. */
export const APP_TZ = typeof window === 'undefined' ? (process.env.APP_TIMEZONE || 'Asia/Dubai') : undefined;
export function todayISO(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export function addDaysISO(n: number, base?: string) {
  const [y, m, dd] = (base || todayISO()).split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, dd + n));
  return d.toISOString().slice(0, 10);
}
export const daysBetweenISO = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);
/** Normalise UAE numbers to +971 form: "050 123 4567" -> "+971501234567". Other numbers are kept as typed (spaces trimmed). */
export function normalizePhone(v?: string | null) {
  if (!v) return null; let s = String(v).replace(/[^\d+]/g, '');
  if (!s) return null;
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (/^0[1-9]\d{7,8}$/.test(s)) s = '+971' + s.slice(1);
  if (/^971\d{8,9}$/.test(s)) s = '+' + s;
  return s;
}
/** Display +971 numbers as "+971 50 123 4567". */
export function formatPhone(v?: string | null) {
  if (!v) return '';
  const m = v.match(/^\+971(5\d)(\d{3})(\d{4})$/) || v.match(/^\+971([2-9])(\d{3})(\d{4})$/);
  return m ? `+971 ${m[1]} ${m[2]} ${m[3]}` : v;
}
/** Contract end = start + term months − 1 day (a 12-month contract from 1 Jan ends 31 Dec). */
export function contractEndFrom(start: string | null | undefined, months: number | null | undefined) {
  if (!start || !months) return null;
  const [y, m, d] = start.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + months, d - 1)).toISOString().slice(0, 10);
}
export const isValidTrn = (v?: string | null) => !v || /^\d{15}$/.test(v.replace(/\s/g, ''));
/** Password rules: 10+ characters, at least one letter and one number, not the email. */
export function passwordProblem(pw: string, email?: string) {
  if (pw.length < 10) return 'Use at least 10 characters.';
  if (!/[a-z]/i.test(pw) || !/\d/.test(pw)) return 'Use both letters and numbers.';
  if (email && pw.toLowerCase().includes(email.split('@')[0].toLowerCase())) return 'Don’t use your email name in the password.';
  return null;
}
export function fmtMoney(n: number | null | undefined, cur = 'AED') {
  if (n == null || Number.isNaN(+n)) return '—';
  try { return new Intl.NumberFormat('en-AE', { style: 'currency', currency: cur || 'AED', maximumFractionDigits: 0 }).format(+n); }
  catch { return `${cur} ${Math.round(+n).toLocaleString()}`; }
}
export function fmtShort(n: number | null | undefined) {
  const v = +(n || 0); const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e5 ? 0 : 1) + 'K';
  return String(Math.round(v));
}
export function fmtDate(v: string | number | Date | null | undefined) {
  if (!v) return '—';
  const d = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T00:00:00') : new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}
export function timeAgo(v: string | number | Date | null | undefined) {
  if (!v) return '';
  const d = Math.floor((Date.now() - new Date(v).getTime()) / DAY);
  if (d <= 0) return 'today'; if (d === 1) return 'yesterday'; if (d < 30) return `${d} days ago`;
  return fmtDate(v);
}
export const fullName = (o?: { firstName?: string | null; lastName?: string | null } | null) => o ? [o.firstName, o.lastName].filter(Boolean).join(' ') : '';
export const tagsOf = (v: unknown): string[] => Array.isArray(v) ? v.map(String) : String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).map((x) => x[0]).join('').slice(0, 2).toUpperCase() || '–';
const AVATAR = ['#4C5BFF', '#E0663A', '#139E6E', '#B7801A', '#C7487A', '#2E8B2E', '#6A57D9', '#D2463F'];
export function avatarColor(id?: string | null) { let h = 0; for (const c of String(id || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return id ? AVATAR[h % 8] : '#8C94AE'; }
export const daysSince = (v: string | Date | number) => Math.floor((Date.now() - new Date(v).getTime()) / DAY);
