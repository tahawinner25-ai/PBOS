import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { decideDemoAccess, DEMO_COOKIE, DEMO_USED_COOKIE, verifyDemoSession, type DemoCheck } from '@/lib/demo-session';

export const demoSecret = () => process.env.DEMO_SESSION_SECRET;

/** Reads the demo cookie and verifies it against the clock. Used by pages, because layouts are cached across navigations. */
export async function currentDemo(): Promise<DemoCheck> {
  return verifyDemoSession((await cookies()).get(DEMO_COOKIE)?.value, demoSecret(), Date.now());
}

export const demoUsed = async (): Promise<boolean> => Boolean((await cookies()).get(DEMO_USED_COOKIE)?.value);

/** Gate for a demo page: returns the milliseconds left, or redirects. The middleware already did this once; this is the second check. */
export async function requireDemo(pathname: string): Promise<number> {
  const decision = await decideDemoAccess({ pathname, cookie: (await cookies()).get(DEMO_COOKIE)?.value, now: Date.now(), secret: demoSecret() });
  if (decision.action === 'allow') return decision.remainingMs;
  if (decision.action === 'redirect') redirect(decision.to);
  redirect('/demo');
}
