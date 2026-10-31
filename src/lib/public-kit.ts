import { engagementRate, hasAnyMetric } from './metrics';
import type { AiPersona, CreatorProfile, FaqItem, Post, RateItem, Service } from './types';

/**
 * What the public media kit may show. Goals, audience notes, user ids and every private record
 * stay out of this shape on purpose: the page can only render what is listed here.
 */
export type PublicProfile = {
  id: string;
  name: string;
  niche: string | null;
  positioning: string | null;
  voice: string | null;
  services: Service[];
  rate_card: RateItem[];
  faq: FaqItem[];
  ai_persona: AiPersona | null;
  avatar_url: string | null;
};

export type PublicProofPost = {
  platform: string | null;
  format: string | null;
  published_at: string | null;
  views: number | null;
  engagement_rate: number | null;
};

/** Proof comes only from real (non-demo) posts the creator logged metrics for. */
export type PublicProof = {
  posts_with_metrics: number;
  platforms: string[];
  recent: PublicProofPost[];
};

type ProfileRow = Pick<
  CreatorProfile,
  'id' | 'name' | 'niche' | 'positioning' | 'voice' | 'services' | 'rate_card' | 'faq' | 'ai_persona' | 'avatar_path'
>;

/** An AI persona is shown only when enabled, and one based on a real person only with confirmed consent. */
export function publicPersona(p: AiPersona | null): AiPersona | null {
  if (!p || !p.enabled || !p.name?.trim() || !p.description?.trim()) return null;
  if (p.based_on_real_person && !p.consent_confirmed) return null;
  return p;
}

export function avatarPublicUrl(path: string | null, supabaseUrl: string | undefined): string | null {
  if (!path || !supabaseUrl) return null;
  return `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/creator-assets/${path}`;
}

/** Null when the profile has no name: a public page with no name would be meaningless. */
export function toPublicProfile(row: ProfileRow, supabaseUrl: string | undefined): PublicProfile | null {
  if (!row.name?.trim()) return null;
  return {
    id: row.id,
    name: row.name.trim(),
    niche: row.niche,
    positioning: row.positioning,
    voice: row.voice,
    services: row.services ?? [],
    rate_card: row.rate_card ?? [],
    faq: row.faq ?? [],
    ai_persona: publicPersona(row.ai_persona),
    avatar_url: avatarPublicUrl(row.avatar_path, supabaseUrl),
  };
}

type ProofPost = Pick<Post, 'platform' | 'format' | 'published_at' | 'views' | 'likes' | 'comments' | 'shares' | 'saves' | 'clicks' | 'is_demo'>;

/** Demo posts and posts without any logged metric never count as proof. Input is expected newest first. */
export function buildProof(posts: ProofPost[]): PublicProof {
  const measured = posts.filter((p) => !p.is_demo && hasAnyMetric(p));
  return {
    posts_with_metrics: measured.length,
    platforms: Array.from(new Set(measured.map((p) => p.platform).filter((x): x is string => Boolean(x)))),
    recent: measured.slice(0, 5).map((p) => ({
      platform: p.platform,
      format: p.format,
      published_at: p.published_at,
      views: p.views,
      engagement_rate: engagementRate(p),
    })),
  };
}
