'use client';

/** Renders only when the root layout itself fails, so it carries its own html and body and uses no app components. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#101223', color: '#F1EEE6' }}>
        <main id="main" style={{ maxWidth: 520, margin: '0 auto', padding: '96px 16px' }}>
          <h1 style={{ fontSize: 28, marginBottom: 12 }}>Something went wrong</h1>
          <p style={{ lineHeight: 1.6, color: '#B4B8CC' }}>PBOS could not load. This is usually temporary. Your data was not changed.</p>
          <button
            type="button"
            onClick={reset}
            style={{ marginTop: 16, padding: '10px 16px', borderRadius: 6, border: 0, background: '#E0B567', color: '#101223', fontWeight: 600, cursor: 'pointer' }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
