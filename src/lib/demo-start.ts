import { demoSecretOk, DEMO_COOKIE, DEMO_USED_COOKIE, DEMO_USED_MS, newDemoSession, signDemoSession, verifyDemoSession } from './demo-session';

/**
 * Decides what happens when someone presses "Start the demo". Pure apart from the injected checks, so the order
 * of the rules is tested: resume a running demo, refuse a second one in the same browser, rate-limit by IP,
 * verify Turnstile when it is on, and only then hand out a fresh 10-minute session.
 */
export type StartInput = {
  cookieHeader: string;
  now: number;
  secret: string | undefined;
  /** Returns false when this IP has started too many demos recently. Only called for a genuinely new start. */
  allowStart: () => boolean;
  turnstile: { mode: 'off' | 'on' | 'misconfigured'; verify: () => Promise<boolean> };
  newSid: () => string;
};

export type StartOutcome = { to: string; cookies: Array<{ name: string; value: string; maxAgeSeconds: number }> };

const readCookie = (header: string, name: string) => header.split(/;\s*/).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);

export async function planDemoStart(input: StartInput): Promise<StartOutcome> {
  const go = (to: string): StartOutcome => ({ to, cookies: [] });
  if (!demoSecretOk(input.secret)) return go('/demo?e=unavailable');

  const existing = await verifyDemoSession(readCookie(input.cookieHeader, DEMO_COOKIE), input.secret, input.now);
  if (existing.state === 'valid') return go('/demo/workspace');
  if (readCookie(input.cookieHeader, DEMO_USED_COOKIE) || existing.state === 'expired') return go('/demo/ended');

  if (!input.allowStart()) return go('/demo?e=busy');
  if (input.turnstile.mode === 'misconfigured') return go('/demo?e=unavailable');
  if (input.turnstile.mode === 'on' && !(await input.turnstile.verify())) return go('/demo?e=captcha');

  const cookie = await signDemoSession(newDemoSession(input.now, input.newSid()), input.secret);
  const maxAgeSeconds = Math.floor(DEMO_USED_MS / 1000);
  // Both cookies outlive the 10 minutes so the server can tell "ended" from "never started". The signed expiry is what locks the demo.
  return { to: '/demo/workspace', cookies: [{ name: DEMO_COOKIE, value: cookie, maxAgeSeconds }, { name: DEMO_USED_COOKIE, value: '1', maxAgeSeconds }] };
}
