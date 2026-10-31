import 'server-only';
import type { AgentData, OpsConnection, OpsJob } from '@/lib/agent/types';
import type { ServerSupabase } from '@/lib/supabase/server';
import type { AgentEvent, CreatorProfile, Deal, Idea, Post, RevenueEntry } from '@/lib/types';

const LIMIT = 200;

function rows<T>(label: string, res: { data: unknown; error: { message: string } | null }): T[] {
  if (res.error) throw new Error(`${label}: ${res.error.message}`);
  return (res.data ?? []) as T[];
}

/**
 * Fetch one creator's records, and only that creator's. Every query filters by creator_id,
 * and RLS enforces the same boundary underneath.
 */
export async function loadAgentData(supabase: ServerSupabase, profile: CreatorProfile): Promise<AgentData> {
  const id = profile.id;
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const [ideas, posts, deals, revenue, events, connections, jobs] = await Promise.all([
    supabase.from('ideas').select('*').eq('creator_id', id).order('created_at', { ascending: false }).limit(LIMIT),
    supabase.from('posts').select('*').eq('creator_id', id).order('published_at', { ascending: false, nullsFirst: false }).limit(LIMIT),
    supabase.from('deals').select('*').eq('creator_id', id).order('created_at', { ascending: false }).limit(LIMIT),
    supabase.from('revenue_entries').select('*').eq('creator_id', id).order('created_at', { ascending: false }).limit(LIMIT),
    supabase.from('agent_events').select('*').eq('creator_id', id).gte('created_at', since).order('created_at', { ascending: false }).limit(400),
    // Safe columns only: the agent never sees a token, a caption or a file path.
    supabase.from('social_connections').select('id, platform, status, last_synced_at, access_token_expires_at, display_name').eq('creator_id', id),
    supabase.from('publish_jobs').select('id, platform, format, title, status, scheduled_for, created_at, updated_at').eq('creator_id', id).order('created_at', { ascending: false }).limit(100),
  ]);
  return {
    profile,
    ideas: rows<Idea>('ideas', ideas),
    posts: rows<Post>('posts', posts),
    deals: rows<Deal>('deals', deals),
    revenue: rows<RevenueEntry>('revenue_entries', revenue),
    events: rows<AgentEvent>('agent_events', events),
    ops: {
      connections: rows<OpsConnection>('social_connections', connections),
      jobs: rows<OpsJob>('publish_jobs', jobs),
      cronConfigured: (process.env.CRON_SECRET ?? '').length >= 24,
    },
  };
}
