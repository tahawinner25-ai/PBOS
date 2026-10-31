import {
  MIN_POSTS_FOR_PATTERN,
  STALE_DAYS,
  type Pillar,
} from '../constants';
import { DAY_MS, ageMs, daysBetween, todayISO } from '../dates';
import { formatDate, formatMoney, formatPct, plural, truncate } from '../format';
import { engagementRate, hasAnyMetric, summarizeAnalytics } from '../metrics';
import { AGENT_CRITICAL_FIELDS, missingProfileFields } from '../profile';
import { daysOverdue, effectiveStatus, followUpLevel } from '../revenue';
import { runOpsChecks } from './ops-checks';
import type { AgentData, Candidate, CheckResult, DraftIntent, Flag } from './types';

const STALE_MS = STALE_DAYS * DAY_MS;
const MAX_IDS = 5;

const LEVEL_NAME = { 1: 'friendly reminder', 2: 'direct follow-up', 3: 'final notice' } as const;

export function dealBrand(data: AgentData, dealId: string | null): string | null {
  if (!dealId) return null;
  return data.deals.find((d) => d.id === dealId)?.brand ?? null;
}

const byTimeAsc = (a: string, b: string) => new Date(a).getTime() - new Date(b).getTime();

/**
 * Deterministic checks. These run before any LLM call and are the only source
 * of flags and candidate recommendations; the LLM may reword them but cannot add new ones.
 */
export function runChecks(data: AgentData, now: Date): CheckResult {
  const flags: Flag[] = [];
  const candidates: Candidate[] = [];

  const push = (
    key: string,
    pillar: Pillar,
    message: string,
    ids: string[],
    action: string,
    reason: string,
    score: number,
    href: string,
    facts: Candidate['facts'],
  ) => {
    const source_record_ids = ids.slice(0, MAX_IDS);
    flags.push({ key, pillar, message, source_record_ids });
    candidates.push({ key, pillar, action, reason, source_record_ids, score, href, facts });
  };

  // 1. Ideas still in "idea" status for more than 7 days.
  const staleIdeas = data.ideas
    .filter((i) => i.status === 'idea' && ageMs(i.created_at, now) > STALE_MS)
    .sort((a, b) => byTimeAsc(a.created_at, b.created_at));
  if (staleIdeas.length > 0) {
    const n = staleIdeas.length;
    const oldest = staleIdeas[0];
    const oldestDays = daysBetween(oldest.created_at, now);
    push(
      'ideas_stale',
      'Ideation',
      `${plural(n, 'idea')} ${n === 1 ? 'has' : 'have'} sat in "idea" status for more than ${STALE_DAYS} days (oldest: ${oldestDays} days)`,
      staleIdeas.map((i) => i.id),
      `Script or retire ${n === 1 ? 'the stale idea' : `the ${n} stale ideas`}, starting with "${truncate(oldest.hook, 60)}"`,
      `${n === 1 ? 'It has' : 'They have'} been unscripted for more than ${STALE_DAYS} days; the oldest has waited ${oldestDays} days.`,
      50,
      '/ideas',
      { count: n, oldest_days: oldestDays, stale_days: STALE_DAYS },
    );
  }

  // 2. Posts with no performance metrics.
  const unmeasured = data.posts
    .filter((p) => !hasAnyMetric(p) && new Date(p.published_at ?? p.created_at).getTime() <= now.getTime())
    .sort((a, b) => byTimeAsc(a.published_at ?? a.created_at, b.published_at ?? b.created_at));
  if (unmeasured.length > 0) {
    const n = unmeasured.length;
    const rated = data.posts.filter((p) => engagementRate(p) !== null).length;
    const reason =
      rated >= MIN_POSTS_FOR_PATTERN
        ? `Format and platform comparisons only use posts with metrics, so ${plural(n, 'post')} ${n === 1 ? 'is' : 'are'} left out until logged.`
        : `Pattern detection is blocked without engagement data: ${rated} of ${plural(data.posts.length, 'post')} ${rated === 1 ? 'has' : 'have'} views logged and ${MIN_POSTS_FOR_PATTERN} are needed to compare formats.`;
    push(
      'posts_unmeasured',
      'Analytics',
      `${plural(n, 'recent post')} ${n === 1 ? 'has' : 'have'} no performance data`,
      unmeasured.map((p) => p.id),
      `Log performance for ${n === 1 ? 'the unmeasured post' : `the ${n} unmeasured posts`}`,
      reason,
      70,
      '/analytics',
      { count: n, measured_with_views: rated, total_posts: data.posts.length, needed_for_patterns: MIN_POSTS_FOR_PATTERN },
    );
  }

  // 3. Deals inactive in the same stage for more than 7 days.
  const staleDeals = data.deals
    .filter((d) => d.stage !== 'paid' && ageMs(d.stage_updated_at, now) > STALE_MS)
    .sort((a, b) => byTimeAsc(a.stage_updated_at, b.stage_updated_at));
  if (staleDeals.length > 0) {
    const n = staleDeals.length;
    const focus = staleDeals[0];
    const days = daysBetween(focus.stage_updated_at, now);
    const brand = focus.brand || 'this brand';
    const value = focus.value !== null && focus.value !== undefined ? ` Deal value as entered: ${formatMoney(Number(focus.value))}.` : '';
    push(
      'deals_stale',
      'Deals',
      `${plural(n, 'deal')} ${n === 1 ? 'has' : 'have'} been in the same stage for more than ${STALE_DAYS} days`,
      staleDeals.map((d) => d.id),
      `Follow up with ${brand} (in "${focus.stage}" for ${days} days)${n > 1 ? ` and review ${plural(n - 1, 'other stale deal')}` : ''}`,
      `${brand} has not changed stage for ${days} days (threshold: ${STALE_DAYS}).${value}`,
      80,
      '/deals',
      { count: n, focus_days_in_stage: days, stale_days: STALE_DAYS },
    );
  }

  // 4. Overdue invoices.
  const overdue = data.revenue
    .filter((e) => effectiveStatus(e, now) === 'overdue')
    .sort((a, b) => daysOverdue(b, now) - daysOverdue(a, now));
  if (overdue.length > 0) {
    const n = overdue.length;
    const focus = overdue[0];
    const days = daysOverdue(focus, now);
    const level = followUpLevel(days);
    const brand = dealBrand(data, focus.deal_id) ?? 'an unlinked invoice';
    const when = days > 0 ? `${days} days overdue` : 'marked overdue';
    push(
      'invoices_overdue',
      'Revenue',
      `${plural(n, 'invoice')} ${n === 1 ? 'is' : 'are'} overdue${days > 0 ? ` (oldest: ${days} days past due)` : ''}`,
      overdue.map((e) => e.id),
      `Send the ${LEVEL_NAME[level]} for ${brand} (${formatMoney(Number(focus.amount), focus.currency)}, ${when})`,
      `${plural(n, 'invoice')} ${n === 1 ? 'is' : 'are'} unpaid past the due date. Escalate in order: friendly reminder, direct follow-up, final notice.`,
      100,
      '/revenue',
      { count: n, oldest_days_overdue: days, follow_up_level: level },
    );
  }

  // 5. High-performing format with no related follow-up idea.
  const summary = summarizeAnalytics(data.posts);
  if (summary.bestFormat) {
    const best = summary.bestFormat;
    const openIdeaInFormat = data.ideas.some(
      (i) =>
        ['idea', 'scripted', 'scheduled'].includes(i.status) &&
        (i.format ?? '').toLowerCase() === best.key.toLowerCase(),
    );
    if (!openIdeaInFormat) {
      push(
        'format_followup',
        'Ideation',
        `${best.key} is your top format by engagement and no open idea uses it`,
        best.postIds,
        `Add a follow-up idea in ${best.key}`,
        `${best.key} averages ${formatPct(best.avgRate)} engagement across ${plural(best.posts, 'post')}, the highest of ${summary.byFormat.length} formats, and no idea in your bank uses it.`,
        55,
        '/ideas',
        { format: best.key, posts: best.posts, formats_compared: summary.byFormat.length },
      );
    }
  }

  // 6. Missing profile information needed for the media kit or outreach.
  const missing = missingProfileFields(data.profile).filter((f) => AGENT_CRITICAL_FIELDS.includes(f.field));
  if (missing.length > 0) {
    const first = missing[0];
    const outreachBlocked = first.needed_for.some((x) => x === 'outreach' || x === 'media kit');
    const openDeals = data.deals.some((d) => d.stage === 'prospecting' || d.stage === 'negotiating');
    push(
      'profile_missing',
      outreachBlocked ? 'Deals' : 'Ideation',
      `Profile is missing: ${missing.map((m) => m.label.toLowerCase()).join(', ')}`,
      missing.map((m) => `profile:${m.field}`),
      `Answer one question in Settings: ${first.question}`,
      `${first.label} is empty and PBOS needs it for ${first.needed_for.join(' and ')}.`,
      outreachBlocked && openDeals ? 75 : 60,
      '/settings',
      { missing_count: missing.length, first_field: first.field },
    );
  }

  // 7. Scheduled ideas that are past their date and not marked posted (Posting pillar).
  const today = todayISO(now);
  const slipped = data.ideas
    .filter((i) => i.status === 'scheduled' && i.scheduled_for && i.scheduled_for < today)
    .sort((a, b) => (a.scheduled_for as string).localeCompare(b.scheduled_for as string));
  if (slipped.length > 0) {
    const n = slipped.length;
    const first = slipped[0];
    push(
      'schedule_slipped',
      'Posting',
      `${plural(n, 'scheduled idea')} ${n === 1 ? 'is' : 'are'} past ${n === 1 ? 'its' : 'their'} date and not marked posted`,
      slipped.map((i) => i.id),
      `Mark "${truncate(first.hook, 60)}" as posted, or move it to a new date`,
      `It was scheduled for ${formatDate(first.scheduled_for)} and is still in "scheduled" status${n > 1 ? `, along with ${plural(n - 1, 'more idea')}` : ''}.`,
      65,
      '/ideas',
      { count: n },
    );
  }

  // 8+. Connections and publishing (only when the caller supplied them).
  const ops = runOpsChecks(data, now);
  flags.push(...ops.flags);
  candidates.push(...ops.candidates);

  candidates.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  return { flags, candidates };
}

/**
 * Choose the single highest-value asset to draft. Only assets tied to a
 * non-suppressed candidate are eligible, in this order:
 * overdue invoice email > stale-deal email > follow-up hook > stale-idea script.
 */
export function selectDraftIntent(data: AgentData, activeKeys: Set<string>, now: Date): DraftIntent | null {
  const creatorName = data.profile.name;

  if (activeKeys.has('invoices_overdue')) {
    const focus = data.revenue
      .filter((e) => effectiveStatus(e, now) === 'overdue')
      .sort((a, b) => daysOverdue(b, now) - daysOverdue(a, now))[0];
    if (focus) {
      const days = daysOverdue(focus, now);
      const level = followUpLevel(days);
      const deal = data.deals.find((d) => d.id === focus.deal_id) ?? null;
      return {
        key: 'invoices_overdue',
        task: 'invoice_followup',
        draftType: 'email',
        platform: 'Email',
        instruction: `Write the ${LEVEL_NAME[level]} email for this overdue invoice. Professional, specific and non-threatening. No late fees or legal wording. Use bracketed placeholders for payment details you were not given.`,
        source_record_ids: [focus.id, ...(deal ? [deal.id] : [])],
        context: {
          creator_name: creatorName,
          follow_up: LEVEL_NAME[level],
          invoice: {
            amount: Number(focus.amount),
            currency: focus.currency,
            due_date: focus.due_date,
            days_overdue: days,
            brand: deal?.brand ?? null,
            contact_name: deal?.contact_name ?? null,
          },
        },
      };
    }
  }

  if (activeKeys.has('deals_stale')) {
    const focus = data.deals
      .filter((d) => d.stage !== 'paid' && ageMs(d.stage_updated_at, now) > STALE_MS)
      .sort((a, b) => byTimeAsc(a.stage_updated_at, b.stage_updated_at))[0];
    if (focus) {
      return {
        key: 'deals_stale',
        task: 'outreach',
        draftType: 'email',
        platform: 'Email',
        instruction:
          'Write a short, specific follow-up email for this stalled deal. Reference the stage and only the deliverables listed. One clear ask. No exaggerated claims, no pricing, no promises.',
        source_record_ids: [focus.id],
        context: {
          creator_name: creatorName,
          deal: {
            brand: focus.brand,
            contact_name: focus.contact_name,
            stage: focus.stage,
            days_in_stage: daysBetween(focus.stage_updated_at, now),
            deliverables: (focus.deliverables ?? []).slice(0, 5).map((d) => truncate(String(d), 80)),
          },
        },
      };
    }
  }

  if (activeKeys.has('format_followup')) {
    const best = summarizeAnalytics(data.posts).bestFormat;
    if (best) {
      const top = data.posts
        .filter((p) => best.postIds.includes(p.id) && p.idea_id)
        .sort((a, b) => (engagementRate(b) ?? 0) - (engagementRate(a) ?? 0));
      for (const post of top) {
        const idea = data.ideas.find((i) => i.id === post.idea_id);
        if (idea?.hook) {
          return {
            key: 'format_followup',
            task: 'followup_hook',
            draftType: 'hook',
            platform: post.platform || idea.platform || 'Other',
            instruction: `Write one new hook for a follow-up piece in the same format (${best.key}). Build on the source hook but take a clearly different angle. Do not reuse its wording. No claims about results.`,
            source_record_ids: [post.id, idea.id],
            context: {
              format: best.key,
              source_hook: truncate(idea.hook, 120),
              average_engagement: formatPct(best.avgRate),
            },
          };
        }
      }
    }
  }

  if (activeKeys.has('ideas_stale')) {
    const idea = data.ideas
      .filter((i) => i.status === 'idea' && ageMs(i.created_at, now) > STALE_MS && i.hook)
      .sort((a, b) => byTimeAsc(a.created_at, b.created_at))[0];
    if (idea) {
      return {
        key: 'ideas_stale',
        task: 'script',
        draftType: 'script',
        platform: idea.platform || 'Other',
        instruction: `Write a short ${idea.format ?? 'post'} script or caption for ${idea.platform || 'the platform'} from this idea hook. Structure: hook, a few beats, one call to action. Match the creator's voice. Introduce no statistics, results or claims.`,
        source_record_ids: [idea.id],
        context: {
          idea: {
            hook: truncate(idea.hook, 160),
            format: idea.format,
            platform: idea.platform,
            content_mix: idea.content_mix,
          },
        },
      };
    }
  }

  return null;
}
