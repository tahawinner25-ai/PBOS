import type { Metadata } from 'next';
import { StoryboardVideo } from '@/components/storyboard-video';
import { PageHeader } from '@/components/page-header';
import { requireCreator } from '@/lib/auth';
import { loadVideoPlan } from '@/lib/server/agent-plans';
import { aiReady } from '@/lib/server/ai';
import { sceneImageDailyLimit } from '@/lib/storyboard/limits';
import { createAdminClient } from '@/lib/supabase/admin';

export const metadata: Metadata = { title: 'Video' };
export const dynamic = 'force-dynamic';
// Making a scene picture can take close to a minute.
export const maxDuration = 120;

export default async function VideoPage({ searchParams }: { searchParams: Promise<{ topic?: string | string[]; plan?: string | string[] }> }) {
  const ctx = await requireCreator();
  if (!ctx) return null;
  const { supabase, profile } = ctx;
  const params = await searchParams;
  const topicParam = params.topic;
  const planParam = Array.isArray(params.plan) ? params.plan[0] : params.plan;
  const plan = await loadVideoPlan(supabase, profile.id, planParam);
  const initialTopic = (Array.isArray(topicParam) ? topicParam[0] : topicParam)?.slice(0, 600) ?? '';
  const day = new Date().toISOString().slice(0, 10);
  const usage = await supabase.from('api_usage').select('units').eq('creator_id', profile.id).eq('provider', 'image').eq('bucket', 'storyboard').eq('day', day).maybeSingle();
  if (usage.error) throw new Error(`video usage: ${usage.error.message}`);

  return (
    <>
      <PageHeader
        title="Video"
        description="Turn an idea into a short video: AI plans the scenes, a free service draws a picture for each one (or you upload your own), and your browser animates it, adds free music or your own audio, and records it. Free to use. Your work is saved in this browser, and nothing is posted from here."
      />
      <StoryboardVideo owner={profile.id} aiReady={aiReady()} picturesReady={Boolean(createAdminClient())} dailyLimit={sceneImageDailyLimit()} usedToday={(usage.data as { units: number } | null)?.units ?? 0} initialTopic={initialTopic} initialPlan={plan} planRequested={Boolean(planParam)} />
    </>
  );
}
