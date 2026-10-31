export const PILLARS = ['Ideation', 'Posting', 'Analytics', 'Deals', 'Revenue'] as const;
export type Pillar = (typeof PILLARS)[number];

export const IDEA_STATUSES = ['idea', 'scripted', 'scheduled', 'posted', 'measured'] as const;
export type IdeaStatus = (typeof IDEA_STATUSES)[number];

export const DEAL_STAGES = ['prospecting', 'negotiating', 'contracted', 'delivery', 'paid'] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export const INVOICE_STATUSES = ['invoiced', 'paid', 'overdue'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const EVENT_TYPES = ['flag', 'suggestion', 'draft', 'accepted', 'ignored'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const PLATFORMS = [
  'Instagram',
  'TikTok',
  'YouTube',
  'LinkedIn',
  'X',
  'Newsletter',
  'Podcast',
  'Other',
] as const;

export const FORMATS = [
  'Short video',
  'Carousel',
  'Image post',
  'Long video',
  'Text post',
  'Thread',
  'Newsletter issue',
  'Story',
  'Podcast episode',
  'Other',
] as const;

export const CONTENT_MIX = [
  'Educational',
  'Entertainment',
  'Personal story',
  'Promotional',
  'Community',
  'Behind the scenes',
] as const;

/** Weighted pipeline probabilities. Delivery and paid are intentionally not weighted. */
export const STAGE_PROBABILITY: Record<DealStage, number> = {
  prospecting: 0.1,
  negotiating: 0.4,
  contracted: 0.8,
  delivery: 0,
  paid: 0,
};

export const STALE_DAYS = 7;
export const MIN_POSTS_FOR_PATTERN = 3;
export const DEFAULT_CURRENCY = 'USD';

export const FORECAST_LABEL = 'Estimate, not guaranteed income.';
export const AI_PERSONA_DISCLOSURE =
  'This persona is AI-generated. You are not talking to a human, and it does not speak for the creator unless they say so.';
export const DRAFT_DISCLAIMER =
  'Draft only. Review and edit before you send it. PBOS never sends email or publishes anything. This is not legal advice.';

export const STAGE_LABEL: Record<DealStage, string> = {
  prospecting: 'Prospecting',
  negotiating: 'Negotiating',
  contracted: 'Contracted',
  delivery: 'Delivery',
  paid: 'Paid',
};
