/**
 * Page-visit counting for PostHog, with no script, no cookie and no storage: a random id lives only in memory for this page
 * load. Only the address of a public page, its referrer and the screen width are sent. Called only after the visitor accepts
 * analytics, and never on signed-in pages (see consent-analytics.tsx). `$process_person_profile: false` means no person is created.
 */
let lastUrl = '';
let anon: string | null = null;

export function trackPageview(key: string, host: string | null): void {
  if (typeof window === 'undefined' || !key.startsWith('phc_')) return;
  const url = `${window.location.origin}${window.location.pathname}`;
  if (url === lastUrl) return;
  lastUrl = url;
  anon = anon ?? (globalThis.crypto?.randomUUID?.() ?? String(Math.random()).slice(2));
  const target = `${(host || 'https://us.i.posthog.com').replace(/\/$/, '')}/i/v0/e/`;
  try {
    void fetch(target, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: key, event: '$pageview', distinct_id: anon,
        properties: { $current_url: url, $pathname: window.location.pathname, $host: window.location.host, $referrer: document.referrer ? new URL(document.referrer).origin : '$direct', $screen_width: window.screen.width, $process_person_profile: false },
      }),
    }).catch(() => undefined);
  } catch {
    // Analytics must never break a page.
  }
}
