import type { Platform } from './types';

/**
 * Quota ledger. YouTube counts quota per Google Cloud project per day and resets at midnight Pacific
 * time. Instagram's own counters are authoritative (`content_publishing_limit`, usage headers), so
 * only YouTube is tracked here.
 *
 * Limits are configuration, not constants: Google's documentation currently lists the default
 * allowance as 10,000 units/day for general calls and a separate bucket of 100 calls/day for
 * `videos.insert`, but also describes `videos.insert` as costing 1,600 units on a different page.
 * We keep a ledger so the app can warn before a limit is hit, and treat Google's `quotaExceeded`
 * response as the source of truth either way. Override with YOUTUBE_QUOTA_DAILY_UNITS and
 * YOUTUBE_UPLOAD_DAILY_LIMIT after checking the Quotas page of your Google Cloud project.
 */

export type QuotaBucket = 'default' | 'uploads';

export type QuotaConfig = { defaultUnits: number; uploadCalls: number };

export const DEFAULT_QUOTA: QuotaConfig = { defaultUnits: 10_000, uploadCalls: 100 };

export const YOUTUBE_COST = {
  'channels.list': 1,
  'playlistItems.list': 1,
  'videos.list': 1,
  'videos.update': 50,
  'thumbnails.set': 50,
} as const;

export function quotaConfigFromEnv(env: Record<string, string | undefined>): QuotaConfig {
  const read = (value: string | undefined, fallback: number) => {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : fallback;
  };
  return { defaultUnits: read(env.YOUTUBE_QUOTA_DAILY_UNITS, DEFAULT_QUOTA.defaultUnits), uploadCalls: read(env.YOUTUBE_UPLOAD_DAILY_LIMIT, DEFAULT_QUOTA.uploadCalls) };
}

export type QuotaStore = {
  /** Units used today for this creator, provider and bucket. */
  used(creatorId: string, provider: Platform, bucket: QuotaBucket, day: string): Promise<number>;
  /** Atomically adds units and returns the new total. */
  bump(creatorId: string, provider: Platform, bucket: QuotaBucket, day: string, units: number): Promise<number>;
};

const PACIFIC = 'America/Los_Angeles';

/** Calendar day (YYYY-MM-DD) in Pacific time, which is when YouTube's quota resets. */
export function pacificDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: PACIFIC, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** The next instant at which the Pacific calendar day changes. Found by search, so DST needs no special case. */
export function nextPacificMidnight(now: Date): Date {
  const today = pacificDay(now);
  let lo = now.getTime();
  let hi = lo + 26 * 3_600_000;
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    if (pacificDay(new Date(mid)) === today) lo = mid;
    else hi = mid;
  }
  return new Date(hi);
}

export type Reservation = { ok: true; used: number; limit: number } | { ok: false; used: number; limit: number; retryAt: Date };

/**
 * Checks, then records, a spend. Check-then-add has a small race between two simultaneous callers;
 * with one creator per deployment that is acceptable, and Google remains the final judge.
 */
export async function reserveYoutube(
  store: QuotaStore,
  args: { creatorId: string; bucket: QuotaBucket; units: number; config: QuotaConfig; now: Date },
): Promise<Reservation> {
  const limit = args.bucket === 'uploads' ? args.config.uploadCalls : args.config.defaultUnits;
  const day = pacificDay(args.now);
  const used = await store.used(args.creatorId, 'youtube', args.bucket, day);
  if (used + args.units > limit) return { ok: false, used, limit, retryAt: nextPacificMidnight(args.now) };
  const total = await store.bump(args.creatorId, 'youtube', args.bucket, day, args.units);
  return { ok: true, used: total, limit };
}
