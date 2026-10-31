import type { Metadata } from 'next';
import Link from 'next/link';
import { createDealFromInquiry, setInquiryStatus } from '@/actions/deals';
import { ActionButton } from '@/components/action-button';
import { DealForm } from '@/components/deal-form';
import { DealsBoard, type BoardDeal } from '@/components/deals-board';
import { EmptyState } from '@/components/empty-state';
import { PageHeader, Section } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { requireCreator } from '@/lib/auth';
import { DEFAULT_CURRENCY } from '@/lib/constants';
import { daysBetween } from '@/lib/dates';
import { formatDate, plural } from '@/lib/format';
import type { Deal, Inquiry } from '@/lib/types';

export const metadata: Metadata = { title: 'Deals' };

export default async function DealsPage() {
  const ctx = await requireCreator();
  if (!ctx) return null;
  const { supabase, profile } = ctx;

  const [dealsRes, inquiriesRes] = await Promise.all([
    supabase.from('deals').select('*').eq('creator_id', profile.id).order('created_at', { ascending: false }).limit(500),
    supabase.from('inquiries').select('*').eq('creator_id', profile.id).neq('status', 'archived').order('created_at', { ascending: false }).limit(50),
  ]);
  if (dealsRes.error) throw new Error(`deals: ${dealsRes.error.message}`);
  if (inquiriesRes.error) throw new Error(`inquiries: ${inquiriesRes.error.message}`);

  const now = new Date();
  const deals: BoardDeal[] = ((dealsRes.data ?? []) as Deal[]).map((d) => ({ ...d, daysInStage: daysBetween(d.stage_updated_at, now) }));
  const inquiries = (inquiriesRes.data ?? []) as Inquiry[];
  const currency = profile.rate_card?.[0]?.currency || DEFAULT_CURRENCY;
  const newInquiries = inquiries.filter((i) => i.status === 'new').length;

  return (
    <>
      <PageHeader
        title="Deals"
        description="Track each brand conversation from first contact to payment. PBOS drafts the outreach; you review it and send it yourself."
        actions={
          <Button asChild variant="outline">
            <Link href="/preview/media-kit">Preview your media kit</Link>
          </Button>
        }
      />

      {deals.length === 0 ? (
        <EmptyState title="No deals yet">
          Add the first brand you are talking to below. Deals that sit in one stage for more than a week get flagged on your dashboard.
        </EmptyState>
      ) : (
        <DealsBoard deals={deals} currency={currency} />
      )}

      <Section id="add" title="Add a deal" className="mt-10">
        <details className="group rounded-lg border border-border" open={deals.length === 0}>
          <summary className="cursor-pointer list-none rounded-lg px-4 py-3 text-sm font-medium hover:bg-accent/40">
            <span className="group-open:hidden">Open the form</span>
            <span className="hidden group-open:inline">Close the form</span>
          </summary>
          <div className="border-t border-border p-4 sm:p-5">
            <DealForm />
          </div>
        </details>
      </Section>

      <Section
        id="inquiries"
        title="Inbound inquiries"
        description={
          inquiries.length > 0
            ? `${plural(newInquiries, 'new message')} from your public media kit contact form.`
            : 'Messages sent through the contact form on your public media kit appear here.'
        }
      >
        {inquiries.length === 0 ? (
          <EmptyState title="No inquiries yet">
            {profile.media_kit_published ? 'Your media kit is published. Messages from brands will show up here.' : 'Publish your media kit in Settings to start receiving messages.'}
          </EmptyState>
        ) : (
          <ul className="ledger" aria-label="Inbound inquiries">
            {inquiries.map((q) => (
              <li key={q.id} className="space-y-2 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{q.name}</span>
                  {q.company ? <span className="text-sm text-muted-foreground">{q.company}</span> : null}
                  {q.status === 'new' ? <Badge>New</Badge> : q.status === 'converted' ? <Badge variant="success">Deal created</Badge> : <Badge variant="outline">Read</Badge>}
                  <span className="ml-auto text-xs text-muted-foreground">{formatDate(q.created_at)}</span>
                </div>
                <p className="text-sm">
                  <a href={`mailto:${q.email}`} className="underline underline-offset-4">
                    {q.email}
                  </a>
                </p>
                <p className="max-w-2xl whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{q.message}</p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {q.status !== 'converted' ? (
                    <ActionButton size="sm" action={createDealFromInquiry.bind(null, q.id)} pendingLabel="Creating…">
                      Create a deal
                    </ActionButton>
                  ) : null}
                  {q.status === 'new' ? (
                    <ActionButton size="sm" variant="outline" action={setInquiryStatus.bind(null, q.id, 'read')} pendingLabel="Saving…">
                      Mark as read
                    </ActionButton>
                  ) : null}
                  <ActionButton size="sm" variant="ghost" action={setInquiryStatus.bind(null, q.id, 'archived')} pendingLabel="Archiving…">
                    Archive
                  </ActionButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
