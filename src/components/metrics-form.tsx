'use client';

import { logMetrics } from '@/actions/posts';
import { ActionForm, Field, SubmitButton } from '@/components/action-form';
import { Input } from '@/components/ui/input';
import type { Post } from '@/lib/types';

const FIELDS = [
  { name: 'views', label: 'Views' },
  { name: 'likes', label: 'Likes' },
  { name: 'comments', label: 'Comments' },
  { name: 'shares', label: 'Shares' },
  { name: 'saves', label: 'Saves' },
  { name: 'clicks', label: 'Link clicks' },
] as const;

/** Numbers come from the platform's own analytics. Blank means "not known": PBOS never fills a gap with an estimate. */
export function MetricsForm({ post }: { post: Post }) {
  return (
    <ActionForm key={post.updated_at} action={logMetrics} className="space-y-4">
      <input type="hidden" name="post_id" value={post.id} />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {FIELDS.map((f) => (
          <Field key={f.name} label={f.label} name={f.name}>
            <Input type="number" inputMode="numeric" min={0} step={1} defaultValue={post[f.name] ?? ''} />
          </Field>
        ))}
      </div>
      <Field label="Notes" name="notes" hint="Optional. Anything that explains the result, such as a collaboration or a repost.">
        <Input defaultValue={post.notes ?? ''} maxLength={500} />
      </Field>
      <SubmitButton size="sm" pendingLabel="Saving…">
        Save metrics
      </SubmitButton>
    </ActionForm>
  );
}
