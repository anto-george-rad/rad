import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth';
import LoginForm from './login-form';
import { BrandPanel, MobileMark } from './brand-panel';

export const metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';
export default async function LoginPage({ searchParams }: { searchParams: { next?: string } }) {
  if (await getUser()) redirect('/');
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <BrandPanel />
      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm animate-rise">
          <MobileMark />
          <LoginForm next={searchParams.next} />
        </div>
      </section>
    </main>
  );
}
