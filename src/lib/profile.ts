import type { CreatorProfile } from './types';

export type ProfileNeed = 'media kit' | 'outreach' | 'recommendations' | 'drafts';

export type MissingField = {
  field: string;
  label: string;
  /** One targeted question to ask the creator. */
  question: string;
  needed_for: ProfileNeed[];
};

type ProfileLike = Pick<
  CreatorProfile,
  'name' | 'niche' | 'positioning' | 'voice' | 'goals' | 'services' | 'rate_card' | 'faq' | 'audience_notes'
>;

const blank = (v: string | null | undefined) => !v || v.trim().length === 0;

/** Ordered by how much each gap blocks the product. */
export function missingProfileFields(p: ProfileLike): MissingField[] {
  const out: MissingField[] = [];
  if (blank(p.name)) {
    out.push({ field: 'name', label: 'Name', question: 'What name should appear on your media kit and in outreach emails?', needed_for: ['media kit', 'outreach'] });
  }
  if (blank(p.positioning)) {
    out.push({ field: 'positioning', label: 'Positioning', question: 'In one sentence, who do you help and how?', needed_for: ['media kit', 'outreach', 'drafts'] });
  }
  if (blank(p.niche)) {
    out.push({ field: 'niche', label: 'Niche', question: 'What topic or niche do you create content about?', needed_for: ['media kit', 'outreach', 'drafts'] });
  }
  if (blank(p.goals?.primary)) {
    out.push({ field: 'goals', label: 'Primary goal', question: 'What is the one goal you want to hit in the next 90 days?', needed_for: ['recommendations'] });
  }
  if (!p.services || p.services.length === 0) {
    out.push({ field: 'services', label: 'Collaboration options', question: 'What is one type of collaboration you want brands to hire you for?', needed_for: ['media kit', 'outreach'] });
  }
  if (!p.rate_card || p.rate_card.length === 0) {
    out.push({ field: 'rate_card', label: 'Rate card', question: 'What is the starting price for your most common deliverable?', needed_for: ['media kit'] });
  }
  if (blank(p.voice)) {
    out.push({ field: 'voice', label: 'Voice', question: 'How would you describe your tone in three words?', needed_for: ['drafts', 'outreach'] });
  }
  if (!p.faq || p.faq.length === 0) {
    out.push({ field: 'faq', label: 'FAQ', question: 'What question do brands ask you most often before booking?', needed_for: ['media kit'] });
  }
  if (blank(p.audience_notes)) {
    out.push({ field: 'audience_notes', label: 'Audience notes', question: 'Who is your audience, in your own words? Leave numbers out unless you can verify them.', needed_for: ['media kit', 'drafts'] });
  }
  return out;
}

/** Fields that gate the agent's profile check (the media kit and outreach basics). */
export const AGENT_CRITICAL_FIELDS = ['name', 'positioning', 'niche', 'goals', 'services', 'rate_card', 'voice'];

export function profileCompleteness(p: ProfileLike): { done: number; total: number; missing: MissingField[] } {
  const missing = missingProfileFields(p);
  const total = 9;
  return { done: total - missing.length, total, missing };
}

export function goalSummary(p: Pick<CreatorProfile, 'goals'>): string | null {
  const primary = p.goals?.primary?.trim();
  const secondary = p.goals?.secondary?.trim();
  if (!primary) return null;
  return secondary ? `${primary} Next: ${secondary}` : primary;
}
