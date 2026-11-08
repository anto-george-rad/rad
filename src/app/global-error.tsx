'use client';
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="en"><body style={{ fontFamily: 'system-ui, sans-serif', display: 'grid', placeItems: 'center', minHeight: '100vh', margin: 0, background: '#F3F5FA', color: '#0D1226' }}>
    <div style={{ maxWidth: 420, textAlign: 'center', padding: 24 }}>
      <h1 style={{ fontSize: 24 }}>The CRM couldn’t load</h1>
      <p style={{ color: '#606882' }}>Please try again in a moment.{error.digest ? ` Reference: ${error.digest}` : ''}</p>
      <button onClick={reset} style={{ marginTop: 12, padding: '10px 16px', borderRadius: 8, border: 0, background: '#4052F0', color: '#fff', fontWeight: 600, cursor: 'pointer' }}>Try again</button>
    </div>
  </body></html>;
}
