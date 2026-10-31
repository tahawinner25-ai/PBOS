import type { AgentData } from '../src/lib/agent/types';
import type { AgentEvent, CreatorProfile, Deal, Idea, Post, RevenueEntry } from '../src/lib/types';

export const NOW = new Date('2026-10-14T12:00:00Z');
export const daysAgo = (n: number, base: Date = NOW) => new Date(base.getTime() - n * 86_400_000).toISOString();
export const dateOnly = (n: number) => daysAgo(n).slice(0, 10);

let seq = 0;
export const uid = () => {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
};

export const CREATOR_ID = '11111111-1111-4111-8111-111111111111';

export function makeProfile(over: Partial<CreatorProfile> = {}): CreatorProfile {
  return {
    id: CREATOR_ID,
    user_id: '22222222-2222-4222-8222-222222222222',
    name: 'Sam Rivera',
    niche: 'personal finance for freelancers',
    positioning: 'I help freelancers build calm, predictable money habits.',
    voice: 'direct, warm, practical',
    goals: { primary: 'Land two brand partnerships this quarter' },
    audience_notes: 'Freelance designers and writers.',
    services: [{ name: 'Sponsored video', description: 'One dedicated short video.' }],
    rate_card: [{ item: 'Sponsored video', price: 1500, currency: 'USD' }],
    faq: [{ q: 'Do you disclose sponsorships?', a: 'Always.' }],
    ai_persona: null,
    media_kit_published: false,
    avatar_path: null,
    created_at: daysAgo(60),
    updated_at: daysAgo(1),
    ...over,
  };
}

export function makeIdea(over: Partial<Idea> = {}): Idea {
  return {
    id: uid(),
    creator_id: CREATOR_ID,
    platform: 'Instagram',
    format: 'Carousel',
    hook: 'Why freelancers should pay themselves a salary',
    hook_variants: [],
    script: null,
    status: 'idea',
    content_mix: 'Educational',
    scheduled_for: null,
    adapted_from: null,
    is_demo: false,
    created_at: daysAgo(2),
    updated_at: daysAgo(2),
    ...over,
  };
}

export function makePost(over: Partial<Post> = {}): Post {
  return {
    id: uid(),
    creator_id: CREATOR_ID,
    idea_id: null,
    platform: 'Instagram',
    format: 'Carousel',
    published_at: daysAgo(3),
    views: null,
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    clicks: null,
    notes: null,
    is_demo: false,
    created_at: daysAgo(3),
    updated_at: daysAgo(3),
    ...over,
  };
}

export function makeDeal(over: Partial<Deal> = {}): Deal {
  return {
    id: uid(),
    creator_id: CREATOR_ID,
    brand: 'Northwind Audio',
    contact_name: 'Priya',
    contact_email: 'priya@example.com',
    stage: 'prospecting',
    value: 4500,
    expected_close_date: null,
    deliverables: ['1 sponsored short video'],
    notes: null,
    stage_updated_at: daysAgo(1),
    is_demo: false,
    created_at: daysAgo(10),
    updated_at: daysAgo(1),
    ...over,
  };
}

export function makeInvoice(over: Partial<RevenueEntry> = {}): RevenueEntry {
  return {
    id: uid(),
    creator_id: CREATOR_ID,
    deal_id: null,
    amount: 1500,
    currency: 'USD',
    status: 'invoiced',
    due_date: dateOnly(-10),
    paid_at: null,
    notes: null,
    is_demo: false,
    created_at: daysAgo(20),
    updated_at: daysAgo(20),
    ...over,
  };
}

export function makeEvent(over: Partial<AgentEvent> & Pick<AgentEvent, 'type'>): AgentEvent {
  return {
    id: uid(),
    creator_id: CREATOR_ID,
    pillar: 'Analytics',
    payload: { key: 'posts_unmeasured', action: 'Log performance for the 3 unmeasured posts' },
    source_record_ids: [],
    created_at: daysAgo(1),
    ...over,
  };
}

export function makeData(over: Partial<AgentData> = {}): AgentData {
  return { profile: makeProfile(), ideas: [], posts: [], deals: [], revenue: [], events: [], ...over };
}

/** A post with full metrics. rate = interactions / views. */
export function measured(over: Partial<Post> & { format: string; platform?: string }, views = 1000, interactions = 50): Post {
  return makePost({
    views,
    likes: Math.round(interactions * 0.6),
    comments: Math.round(interactions * 0.1),
    shares: Math.round(interactions * 0.1),
    saves: interactions - Math.round(interactions * 0.6) - Math.round(interactions * 0.1) * 2,
    clicks: 5,
    ...over,
  });
}
