import type { DealStage, EventType, IdeaStatus, InvoiceStatus } from './constants';

export type Goals = { primary?: string; secondary?: string };
export type Service = { name: string; description: string };
export type RateItem = { item: string; price: number | null; currency: string; notes?: string };
export type FaqItem = { q: string; a: string };
export type AiPersona = {
  enabled: boolean;
  name: string;
  description: string;
  based_on_real_person: boolean;
  consent_confirmed: boolean;
};
export type HookVariant = { angle: string; hook: string };

export type CreatorProfile = {
  id: string;
  user_id: string;
  name: string | null;
  niche: string | null;
  positioning: string | null;
  voice: string | null;
  goals: Goals;
  audience_notes: string | null;
  services: Service[];
  rate_card: RateItem[];
  faq: FaqItem[];
  ai_persona: AiPersona | null;
  /** Additive column: the public media kit is private until the creator publishes it. */
  media_kit_published: boolean;
  /** Additive column: path inside the creator-assets storage bucket. */
  avatar_path: string | null;
  created_at: string;
  updated_at: string;
};

export type Idea = {
  id: string;
  creator_id: string;
  platform: string | null;
  format: string | null;
  hook: string | null;
  hook_variants: HookVariant[];
  script: string | null;
  status: IdeaStatus;
  content_mix: string | null;
  scheduled_for: string | null;
  adapted_from: string | null;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
};

export type Post = {
  id: string;
  creator_id: string;
  idea_id: string | null;
  platform: string | null;
  format: string | null;
  published_at: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  clicks: number | null;
  notes: string | null;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
  /** Present on rows read from the database (migration 0005). 'manual' = typed in by the creator. */
  title?: string | null;
  source?: 'manual' | 'youtube' | 'instagram';
  external_url?: string | null;
  metrics_synced_at?: string | null;
};

export type Deal = {
  id: string;
  creator_id: string;
  brand: string | null;
  contact_name: string | null;
  contact_email: string | null;
  stage: DealStage;
  value: number | null;
  expected_close_date: string | null;
  deliverables: string[];
  notes: string | null;
  stage_updated_at: string;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
};

export type RevenueEntry = {
  id: string;
  creator_id: string;
  deal_id: string | null;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  due_date: string | null;
  paid_at: string | null;
  notes: string | null;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
};

export type AgentEvent = {
  id: string;
  creator_id: string;
  type: EventType;
  pillar: string | null;
  payload: Record<string, unknown>;
  source_record_ids: string[];
  created_at: string;
};

export type Inquiry = {
  id: string;
  creator_id: string;
  name: string;
  email: string;
  company: string | null;
  message: string;
  status: 'new' | 'read' | 'converted' | 'archived';
  created_at: string;
};

export type ActionResult<T = undefined> =
  | { ok: true; message?: string; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };
