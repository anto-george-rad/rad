'use client';
import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui';

/** Shown when a page fails to load. The error is logged on the server; the digest helps find it. */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return <div className="mx-auto mt-16 flex max-w-md flex-col items-center gap-3 text-center">
    <span className="grid h-14 w-14 place-items-center rounded-2xl bg-bad-soft text-bad"><AlertTriangle /></span>
    <h1 className="font-display text-2xl font-bold tracking-tight">This page didn’t load</h1>
    <p className="text-muted">Something went wrong on our side. Try again; if it keeps happening, send your admin this reference{error.digest ? <>: <code className="num rounded bg-sunken px-1.5">{error.digest}</code></> : '.'}</p>
    <div className="mt-2 flex gap-2"><Button variant="primary" onClick={reset}>Try again</Button><a href="/"><Button>Go to Home</Button></a></div>
  </div>;
}
