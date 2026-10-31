import { daysBetween } from '../dates';
import { formatMoney, truncate } from '../format';
import { hasAnyMetric } from '../metrics';
import { daysOverdue, effectiveStatus } from '../revenue';
import type { AgentData } from './types';

export type SourceRef = {
  id: string;
  kind: 'idea' | 'post' | 'deal' | 'invoice' | 'profile' | 'connection' | 'publish' | 'unknown';
  label: string;
  href: string;
  isDemo: boolean;
};

const PROFILE_PREFIX = 'profile:';

/** Turn a source_record_id into a human-readable reference with a link. */
export function resolveSource(id: string, data: AgentData): SourceRef {
  if (id.startsWith(PROFILE_PREFIX)) {
    const field = id.slice(PROFILE_PREFIX.length);
    return { id, kind: 'profile', label: `Creator profile: ${field.replace(/_/g, ' ')}`, href: '/settings', isDemo: false };
  }
  const idea = data.ideas.find((i) => i.id === id);
  if (idea) return { id, kind: 'idea', label: `Idea: "${truncate(idea.hook, 50)}"`, href: '/ideas', isDemo: idea.is_demo };
  const post = data.posts.find((p) => p.id === id);
  if (post) {
    return { id, kind: 'post', label: `Post: ${[post.platform, post.format].filter(Boolean).join(' ') || 'untitled'}`, href: '/analytics', isDemo: post.is_demo };
  }
  const deal = data.deals.find((d) => d.id === id);
  if (deal) return { id, kind: 'deal', label: `Deal: ${deal.brand || 'unnamed'} (${deal.stage})`, href: '/deals', isDemo: deal.is_demo };
  const inv = data.revenue.find((e) => e.id === id);
  if (inv) {
    const brand = data.deals.find((d) => d.id === inv.deal_id)?.brand;
    return { id, kind: 'invoice', label: `Invoice: ${brand ?? 'no linked deal'}, ${formatMoney(Number(inv.amount), inv.currency)}`, href: '/revenue', isDemo: inv.is_demo };
  }
  const conn = data.ops?.connections.find((c) => c.id === id);
  if (conn) return { id, kind: 'connection', label: `Connection: ${conn.platform === 'youtube' ? 'YouTube' : 'Instagram'}${conn.display_name ? ` (${truncate(conn.display_name, 40)})` : ''}`, href: '/connections', isDemo: false };
  const job = data.ops?.jobs.find((j) => j.id === id);
  if (job) return { id, kind: 'publish', label: `Post: ${truncate(job.title ?? `${job.platform} ${job.format}`, 50)} (${job.status.replace('_', ' ')})`, href: '/publish', isDemo: false };
  return { id, kind: 'unknown', label: 'Record no longer available', href: '/dashboard', isDemo: false };
}

/** Minimal record sent to the LLM. Only fields needed for the finding; no contact emails. */
export function minimalRecord(id: string, data: AgentData, now: Date): Record<string, unknown> | null {
  if (id.startsWith(PROFILE_PREFIX)) {
    const field = id.slice(PROFILE_PREFIX.length);
    return { id, type: 'profile_field', field, status: 'empty' };
  }
  const idea = data.ideas.find((i) => i.id === id);
  if (idea) {
    return {
      id,
      type: 'idea',
      hook: truncate(idea.hook, 100),
      platform: idea.platform,
      format: idea.format,
      status: idea.status,
      days_old: daysBetween(idea.created_at, now),
      scheduled_for: idea.scheduled_for,
    };
  }
  const post = data.posts.find((p) => p.id === id);
  if (post) {
    return {
      id,
      type: 'post',
      platform: post.platform,
      format: post.format,
      days_since_published: daysBetween(post.published_at ?? post.created_at, now),
      has_metrics: hasAnyMetric(post),
      views: post.views,
      likes: post.likes,
      comments: post.comments,
      shares: post.shares,
      saves: post.saves,
      clicks: post.clicks,
    };
  }
  const deal = data.deals.find((d) => d.id === id);
  if (deal) {
    return {
      id,
      type: 'deal',
      brand: deal.brand,
      stage: deal.stage,
      days_in_stage: daysBetween(deal.stage_updated_at, now),
      value: deal.value,
      expected_close_date: deal.expected_close_date,
    };
  }
  const inv = data.revenue.find((e) => e.id === id);
  if (inv) {
    return {
      id,
      type: 'invoice',
      brand: data.deals.find((d) => d.id === inv.deal_id)?.brand ?? null,
      amount: Number(inv.amount),
      currency: inv.currency,
      due_date: inv.due_date,
      days_overdue: daysOverdue(inv, now),
      status: effectiveStatus(inv, now),
    };
  }
  const conn = data.ops?.connections.find((c) => c.id === id);
  if (conn) {
    return { id, type: 'connection', platform: conn.platform, status: conn.status, days_since_sync: conn.last_synced_at ? daysBetween(conn.last_synced_at, now) : null };
  }
  const job = data.ops?.jobs.find((j) => j.id === id);
  if (job) {
    return { id, type: 'publish_job', platform: job.platform, format: job.format, title: truncate(job.title, 60) || null, status: job.status, scheduled_for: job.scheduled_for, days_since_update: daysBetween(job.updated_at, now) };
  }
  return null;
}
