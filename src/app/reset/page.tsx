import { BrandPanel, MobileMark } from '../login/brand-panel';
import ResetForm from './reset-form';

export const metadata = { title: 'Choose a new password' };
export const dynamic = 'force-dynamic';
export default function ResetPage({ searchParams }: { searchParams: { token?: string } }) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <BrandPanel />
      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm animate-rise"><MobileMark /><ResetForm token={searchParams.token || ''} /></div>
      </section>
    </main>
  );
}
