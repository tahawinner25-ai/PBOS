import type { Pillar } from '../constants';
import { DAY_MS, ageMs, daysBetween } from '../dates';
import { plural, truncate } from '../format';
import type { AgentData, Candidate, CheckResult, Flag, OpsJob } from './types';

/**
 * Deterministic checks for connections and publishing. Like the rest of the agent they only read records,
 * propose an action and cite the records behind it; nothing here posts, retries or reconnects anything.
 */

const MAX_IDS = 5;
const STALE_SYNC_DAYS = 3;
const TOKEN_WARN_DAYS = 7;
const OVERDUE_GRACE_MS = 15 * 60_000;
const DRAFT_WAIT_DAYS = 2;
const FAILED_WINDOW_DAYS = 14;

const NAME = { youtube: 'YouTube', instagram: 'Instagram' } as const;
const label = (j: OpsJob) => truncate(j.title ?? `${NAME[j.platform]} ${j.format}`, 60);

export function runOpsChecks(data: AgentData, now: Date): CheckResult {
  const flags: Flag[] = [];
  const candidates: Candidate[] = [];
  const ops = data.ops;
  if (!ops) return { flags, candidates };

  const push = (key: string, pillar: Pillar, message: string, ids: string[], action: string, reason: string, score: number, href: string, facts: Candidate['facts']) => {
    const source_record_ids = ids.slice(0, MAX_IDS);
    flags.push({ key, pillar, message, source_record_ids });
    candidates.push({ key, pillar, action, reason, source_record_ids, score, href, facts });
  };

  // 1. A publish whose result is unknown. PBOS will not post it again until the creator checks.
  const review = ops.jobs.filter((j) => j.status === 'needs_review').sort((a, b) => a.updated_at.localeCompare(b.updated_at));
  if (review.length > 0) {
    const first = review[0];
    push(
      'publish_needs_review', 'Posting',
      `${plural(review.length, 'post')} may or may not have gone live: ${NAME[first.platform]} did not confirm the result`,
      review.map((j) => j.id),
      `Open ${NAME[first.platform]}, look for "${label(first)}", then tell PBOS whether it is live`,
      'The platform did not confirm the publish. PBOS will not post it again until you check, so it cannot create a duplicate.',
      98, '/publish', { count: review.length },
    );
  }

  // 2. Connections that no longer work.
  const broken = ops.connections.filter((c) => c.status !== 'active');
  if (broken.length > 0) {
    const first = broken[0];
    push(
      'connection_reauth', 'Posting',
      `${broken.map((c) => NAME[c.platform]).join(' and ')} ${broken.length === 1 ? 'needs' : 'need'} to be reconnected`,
      broken.map((c) => c.id),
      `Reconnect ${NAME[first.platform]} on the Connections page`,
      `${NAME[first.platform]} no longer accepts the saved sign-in, so posting and number syncing are paused until you reconnect.`,
      92, '/connections', { count: broken.length, platform: first.platform },
    );
  }

  // 3. Posts that failed recently.
  const failed = ops.jobs
    .filter((j) => j.status === 'failed' && ageMs(j.updated_at, now) < FAILED_WINDOW_DAYS * DAY_MS)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  if (failed.length > 0) {
    const first = failed[0];
    push(
      'publish_failed', 'Posting',
      `${plural(failed.length, 'post')} failed to publish in the last ${FAILED_WINDOW_DAYS} days`,
      failed.map((j) => j.id),
      `Open "${label(first)}" on the Publish page, read the error, then retry or cancel it`,
      `It failed on ${NAME[first.platform]} ${daysBetween(first.updated_at, now) === 0 ? 'today' : `${plural(daysBetween(first.updated_at, now), 'day')} ago`}. The error is shown on the post.`,
      90, '/publish', { count: failed.length },
    );
  }

  // 4. Approved Instagram posts that are well past their time. Something is not running the scheduled job.
  const late = ops.jobs.filter((j) => j.platform === 'instagram' && j.status === 'scheduled' && j.scheduled_for && new Date(j.scheduled_for).getTime() < now.getTime() - OVERDUE_GRACE_MS);
  if (late.length > 0) {
    push(
      'schedule_not_running', 'Posting',
      `${plural(late.length, 'approved Instagram post')} ${late.length === 1 ? 'is' : 'are'} past ${late.length === 1 ? 'its' : 'their'} time and still waiting`,
      late.map((j) => j.id),
      ops.cronConfigured ? 'Open the Publish page to see why they are waiting, or cancel them' : 'Set up the scheduled job (CRON_SECRET and a caller) so approved Instagram posts go out on time',
      ops.cronConfigured ? 'They were approved and are overdue by more than 15 minutes, so the scheduled job may be failing or blocked by an account problem.' : 'Instagram has no scheduling feature of its own, so PBOS posts at the chosen time from a scheduled job, and this deployment has none configured.',
      88, '/publish', { count: late.length, cron_configured: ops.cronConfigured ? 1 : 0 },
    );
  }

  // 5. A login that is about to expire.
  const expiring = ops.connections.filter((c) => c.status === 'active' && c.access_token_expires_at && c.platform === 'instagram' && Date.parse(c.access_token_expires_at) - now.getTime() < TOKEN_WARN_DAYS * DAY_MS && Date.parse(c.access_token_expires_at) > now.getTime());
  if (expiring.length > 0) {
    const c = expiring[0];
    const left = Math.max(0, Math.floor((Date.parse(c.access_token_expires_at as string) - now.getTime()) / DAY_MS));
    push(
      'token_expiring', 'Posting',
      `Your Instagram sign-in expires in ${plural(left, 'day')}`,
      [c.id],
      'Reconnect Instagram on the Connections page before it expires',
      'PBOS renews the sign-in automatically while it works. It has not renewed this one, so reconnecting now avoids a gap in posting and numbers.',
      85, '/connections', { days_left: left },
    );
  }

  // 6. Numbers that have not synced.
  const staleSync = ops.connections.filter((c) => c.status === 'active' && (!c.last_synced_at || ageMs(c.last_synced_at, now) > STALE_SYNC_DAYS * DAY_MS));
  if (staleSync.length > 0) {
    const c = staleSync[0];
    const days = c.last_synced_at ? daysBetween(c.last_synced_at, now) : null;
    push(
      'sync_stale', 'Analytics',
      `${NAME[c.platform]} numbers ${days === null ? 'have never been synced' : `were last synced ${plural(days, 'day')} ago`}`,
      staleSync.map((x) => x.id),
      `Choose "Sync now" for ${NAME[c.platform]} on the Analytics page`,
      days === null ? 'The account is connected but no sync has completed, so the Analytics page has no platform numbers for it.' : `Analytics for ${NAME[c.platform]} is ${plural(days, 'day')} out of date (threshold: ${STALE_SYNC_DAYS}).`,
      60, '/analytics', { count: staleSync.length, days_since_sync: days },
    );
  }

  // 7. Drafts that have waited for approval.
  const drafts = ops.jobs.filter((j) => j.status === 'draft' && ageMs(j.created_at, now) > DRAFT_WAIT_DAYS * DAY_MS).sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (drafts.length > 0) {
    push(
      'drafts_waiting', 'Posting',
      `${plural(drafts.length, 'post draft')} ${drafts.length === 1 ? 'has' : 'have'} waited more than ${DRAFT_WAIT_DAYS} days for your approval`,
      drafts.map((j) => j.id),
      `Approve or delete the draft "${label(drafts[0])}"`,
      `Nothing is posted until you approve, and the oldest draft has waited ${plural(daysBetween(drafts[0].created_at, now), 'day')}.`,
      45, '/publish', { count: drafts.length },
    );
  }

  // 8. Numbers typed in by hand while an account could supply them.
  const manual = data.posts.filter((p) => (p.source ?? 'manual') === 'manual' && (p.platform === 'YouTube' || p.platform === 'Instagram'));
  if (ops.connections.length === 0 && manual.length > 0) {
    push(
      'no_connection', 'Analytics',
      `${plural(manual.length, 'YouTube or Instagram post')} ${manual.length === 1 ? 'is' : 'are'} tracked by hand and no account is connected`,
      manual.map((p) => p.id),
      'Connect YouTube or Instagram so PBOS can read these numbers itself',
      'Connected accounts sync views and engagement straight from the platform, so you stop typing them in and PBOS compares real figures.',
      35, '/connections', { count: manual.length },
    );
  }

  return { flags, candidates };
}
