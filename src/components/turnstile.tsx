'use client';

import { useEffect, useRef } from 'react';

type TurnstileApi = {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  remove(widgetId: string): void;
  reset(widgetId?: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** Clears the widget so it issues a fresh token. A token works once, so call this after every submit attempt. */
export function resetTurnstile() {
  try {
    window.turnstile?.reset();
  } catch {
    // The widget may not be on the page; nothing to reset.
  }
}

/**
 * Cloudflare Turnstile widget for forms. Renders only when a site key is configured. On success it adds a
 * hidden `cf-turnstile-response` field to the surrounding form, which the server verifies.
 * The script loads from challenges.cloudflare.com only on pages that show this component.
 */
export function Turnstile({ siteKey }: { siteKey: string }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    let widgetId: string | undefined;
    let cancelled = false;

    const mount = () => {
      if (cancelled || widgetId || !window.turnstile) return;
      widgetId = window.turnstile.render(el, { sitekey: siteKey, theme: 'auto', 'response-field-name': 'cf-turnstile-response' });
    };

    let script = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (window.turnstile) {
      mount();
    } else {
      if (!script) {
        script = document.createElement('script');
        script.src = SCRIPT_SRC;
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
      script.addEventListener('load', mount);
    }

    return () => {
      cancelled = true;
      script?.removeEventListener('load', mount);
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey]);

  return <div ref={container} className="min-h-[65px]" />;
}
