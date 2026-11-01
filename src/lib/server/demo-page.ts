import 'server-only';
import { buildDemoView, type DemoView } from '@/lib/demo-workspace';
import { requireDemo } from '@/lib/server/demo';

/** Every sample page starts here: the server re-checks the signed demo cookie, then builds the sample records. */
export async function loadDemoPage(pathname: string): Promise<{ remainingMs: number; now: Date; view: DemoView }> {
  const remainingMs = await requireDemo(pathname);
  const now = new Date();
  return { remainingMs, now, view: buildDemoView(now) };
}

/** Where a source record lives in the sample workspace. */
export const DEMO_SOURCE_HREF = {
  idea: '/demo/workspace/ideas', post: '/demo/workspace/analytics', deal: '/demo/workspace/deals', invoice: '/demo/workspace/revenue',
  profile: '/demo/workspace', connection: '/demo/workspace/connections', publish: '/demo/workspace/posting', unknown: '/demo/workspace',
} as const;
