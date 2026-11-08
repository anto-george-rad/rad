import { rateByToken } from '@/lib/portal-actions';
import { RateThanks } from '@/components/portal';
import { ToastProvider } from '@/components/ui';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Thanks for your feedback' };
/** Landing page for the rating links in resolution emails. */
export default async function Rate({ params }: { params: { id: string; tok: string; v: string } }) {
  const r = await rateByToken(params.id, params.tok, params.v);
  return <ToastProvider><main className="grid min-h-dvh place-items-center bg-bg p-6"><RateThanks ok={r.ok} error={r.ok ? '' : r.error} id={params.id} tok={params.tok} v={params.v} /></main></ToastProvider>;
}
