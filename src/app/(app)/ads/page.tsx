import type { Metadata } from 'next';
import { deleteAdDraft, setAdStatus } from '@/actions/ads';
import { ActionButton } from '@/components/action-button';
import { AdsStudio } from '@/components/ads-studio';
import { CopyButton } from '@/components/copy-button';
import { EmptyState } from '@/components/empty-state';
import { PageHeader, Section } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { requireCreator } from '@/lib/auth';
import { AD_FORMATS, adAsText, isAdFormat, type AdVariant } from '@/lib/ads';
import { formatDate } from '@/lib/format';

export const metadata: Metadata = { title: 'Ads' };
export const dynamic = 'force-dynamic';
// Drafting calls the model, and it may retry once.
export const maxDuration = 60;

type Row = { id: string; platform: string; objective: string | null; offer: string | null; headline: string | null; primary_text: string | null; description: string | null; cta: string | null; media_asset_id: string | null; status: 'draft' | 'approved' | 'archived'; created_at: string };

export default async function AdsPage() {
  const ctx = await requireCreator();
  if (!ctx) return null;
  const { supabase, profile } = ctx;
  const [adsRes, imgRes] = await Promise.all([
    supabase.from('ad_creatives').select('id, platform, objective, offer, headline, primary_text, description, cta, media_asset_id, status, created_at').eq('creator_id', profile.id).neq('status', 'archived').order('created_at', { ascending: false }).limit(50),
    supabase.from('media_assets').select('id, label, ai_generated').eq('creator_id', profile.id).eq('kind', 'image').order('created_at', { ascending: false }).limit(50),
  ]);
  if (adsRes.error) throw new Error(`ads: ${adsRes.error.message}`);
  if (imgRes.error) throw new Error(`ads media: ${imgRes.error.message}`);
  const ads = (adsRes.data ?? []) as unknown as Row[];
  const images = ((imgRes.data ?? []) as Array<{ id: string; label: string | null; ai_generated: boolean }>).map((i) => ({ id: i.id, label: i.label ?? 'Image', ai: i.ai_generated }));

  return (
    <>
      <PageHeader title="Ads" description="Draft ad copy that fits each platform’s limits. PBOS writes drafts only: it never connects to an ads account, creates a campaign or spends money." />
      <Alert variant="info" title="How this works" className="mb-8">
        You describe the real offer, PBOS drafts three versions, you edit and save one, and you paste it into Meta Ads Manager or Google Ads yourself. Each platform reviews ads under its own policies, and nothing here predicts how an ad will perform.
      </Alert>

      <Section title="New ad copy">
        <div className="rounded-lg border border-border bg-card p-5">
          <AdsStudio aiReady={Boolean(process.env.ANTHROPIC_API_KEY)} images={images} hasProfileAudience={Boolean((profile.audience_notes ?? '').trim())} />
        </div>
      </Section>

      <Section title="Saved drafts">
        {ads.length === 0 ? (
          <EmptyState title="No ad drafts yet">Draft some copy above and save the version you like.</EmptyState>
        ) : (
          <ul className="space-y-3">
            {ads.map((a) => {
              const format = isAdFormat(a.platform) ? a.platform : null;
              const variant: AdVariant = { angle: '', headline: a.headline ?? '', primary_text: a.primary_text ?? '', description: a.description ?? '', cta: a.cta ?? '' };
              return (
                <li key={a.id} className="rounded-lg border border-border bg-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm text-muted-foreground">{format ? AD_FORMATS[format].label : a.platform}{a.objective ? ` · ${a.objective}` : ''} · {formatDate(a.created_at)}</p>
                    <div className="flex gap-1.5"><Badge variant="secondary">AI-generated</Badge><Badge variant={a.status === 'approved' ? 'success' : 'outline'}>{a.status === 'approved' ? 'Ready to paste' : 'Draft'}</Badge></div>
                  </div>
                  <p className="mt-2 font-medium">{a.headline}</p>
                  <p className="text-sm leading-relaxed">{a.primary_text}</p>
                  {a.description ? <p className="text-sm text-muted-foreground">{a.description}</p> : null}
                  <p className="mt-1 text-xs text-muted-foreground">Button: {a.cta}{a.media_asset_id ? ' · image attached' : ''}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {format ? <CopyButton text={adAsText(variant, format)} size="sm" variant="secondary" /> : null}
                    {a.status === 'draft' ? <ActionButton size="sm" variant="ghost" action={setAdStatus.bind(null, a.id, 'approved')}>Mark ready</ActionButton> : <ActionButton size="sm" variant="ghost" action={setAdStatus.bind(null, a.id, 'draft')}>Back to draft</ActionButton>}
                    <ActionButton size="sm" variant="ghost" action={setAdStatus.bind(null, a.id, 'archived')}>Archive</ActionButton>
                    <ActionButton size="sm" variant="ghost" action={deleteAdDraft.bind(null, a.id)} confirm="Delete this draft permanently?">Delete</ActionButton>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </>
  );
}
