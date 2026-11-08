import Link from 'next/link';
export default function NotFound() {
  return <div className="mx-auto mt-16 flex max-w-md flex-col items-center gap-3 text-center">
    <h1 className="font-display text-2xl font-bold tracking-tight">Not found</h1>
    <p className="text-muted">This record may have been deleted or merged into another one.</p>
    <Link href="/" className="font-semibold text-accent hover:underline">Go to Home</Link>
  </div>;
}
