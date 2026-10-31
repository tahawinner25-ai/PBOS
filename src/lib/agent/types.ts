import type { Pillar } from '../constants';
import type { AgentEvent, CreatorProfile, Deal, Idea, Post, RevenueEntry } from '../types';

/** Connection state the agent may see. Never contains a token or a secret. */
export type OpsConnection = {
  id: string;
  platform: 'youtube' | 'instagram';
  status: 'active' | 'needs_reauth' | 'revoked';
  last_synced_at: string | null;
  access_token_expires_at: string | null;
  display_name: string | null;
};

/** Publishing state the agent may see. Captions and file paths are left out. */
export type OpsJob = {
  id: string;
  platform: 'youtube' | 'instagram';
  format: string;
  title: string | null;
  status: 'draft' | 'scheduled' | 'uploading' | 'processing' | 'platform_scheduled' | 'published' | 'failed' | 'needs_review' | 'cancelled';
  scheduled_for: string | null;
  created_at: string;
  updated_at: string;
};

export type OpsData = { connections: OpsConnection[]; jobs: OpsJob[]; cronConfigured: boolean };

export type AgentData = {
  profile: CreatorProfile;
  ideas: Idea[];
  posts: Post[];
  deals: Deal[];
  revenue: RevenueEntry[];
  events: AgentEvent[];
  /** Connections and publishing. Optional so the pure checks keep working without a database. */
  ops?: OpsData;
};

export type Flag = {
  key: string;
  pillar: Pillar;
  message: string;
  source_record_ids: string[];
};

export type Candidate = {
  key: string;
  pillar: Pillar;
  action: string;
  reason: string;
  source_record_ids: string[];
  score: number;
  href: string;
  facts: Record<string, string | number | null>;
};

export type DraftType = 'caption' | 'email' | 'hook' | 'script';

export type DraftIntent = {
  key: string;
  task: 'invoice_followup' | 'outreach' | 'followup_hook' | 'script';
  draftType: DraftType;
  platform: string;
  instruction: string;
  source_record_ids: string[];
  context: Record<string, unknown>;
};

export type CheckResult = { flags: Flag[]; candidates: Candidate[] };

export type Recommendation = {
  key: string;
  pillar: Pillar;
  action: string;
  reason: string;
  source_record_ids: string[];
  href: string;
};

export type DraftOutput = {
  /** Key of the finding this draft serves (e.g. invoices_overdue). */
  key: string;
  type: DraftType;
  platform: string;
  content: string;
  source_record_ids: string[];
};
