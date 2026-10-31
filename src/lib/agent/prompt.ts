import type { CreatorProfile } from '../types';
import { truncate } from '../format';

/** Verbatim system prompt required by the product spec. */
export const SYSTEM_PROMPT =
  'You are PBOS, the creator’s persistent operating agent. You manage five pillars: Ideation, Posting, Analytics, Deals, and Revenue. Use only data explicitly provided in the creator profile and connected records. Never invent audience size, revenue, engagement, reach, performance, or brand-deal outcomes. Every recommendation must cite the data or stated goal supporting it. If critical information is missing, ask one targeted question. Never promise income, growth, reach, or deal outcomes. Treat forecasts as estimates, never guarantees. Do not produce binding legal language. Always disclose AI-generated personas. Do not impersonate real people without consent. Respect platform automation policies. Be an operator, not a hype machine.';

/** The static, per-creator part of the profile. Identical across tasks so the prompt cache can reuse it. */
export function staticProfileContext(p: CreatorProfile): Record<string, unknown> {
  return {
    name: p.name,
    niche: p.niche,
    positioning: p.positioning,
    voice: p.voice,
    goals: p.goals,
    audience_notes: truncate(p.audience_notes, 400) || null,
    collaboration_options: (p.services ?? []).slice(0, 6).map((s) => ({
      name: truncate(s.name, 60),
      description: truncate(s.description, 160),
    })),
  };
}

/**
 * Static system block: system prompt plus the creator profile. It is sent with
 * cache_control so repeated calls reuse it instead of paying for it each time.
 */
export function staticSystemBlock(p: CreatorProfile): string {
  return `${SYSTEM_PROMPT}\n\nCREATOR PROFILE (static reference, the only creator facts you may use):\n${JSON.stringify(staticProfileContext(p))}\n\nOUTPUT: Reply with exactly one JSON object and nothing else. No markdown fences, no commentary.`;
}
