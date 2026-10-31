'use client';

import { createPost } from '@/actions/posts';
import { ActionForm, Field, SubmitButton } from '@/components/action-form';
import { Options } from '@/components/options';
import { Input, Select } from '@/components/ui/input';
import { FORMATS, PLATFORMS } from '@/lib/constants';
import { truncate } from '@/lib/format';

/** Add a post that is already live. PBOS records it; it never publishes. */
export function AddPostForm({ ideas, today }: { ideas: Array<{ id: string; hook: string | null; platform: string | null }>; today: string }) {
  return (
    <ActionForm action={createPost} className="space-y-4" resetOnSuccess>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Platform" name="platform" required>
          <Select defaultValue={PLATFORMS[0]}>
            <Options values={PLATFORMS} />
          </Select>
        </Field>
        <Field label="Format" name="format" required>
          <Select defaultValue={FORMATS[0]}>
            <Options values={FORMATS} />
          </Select>
        </Field>
        <Field label="Published on" name="published_at" hint="Leave empty for today.">
          <Input type="date" max={today} />
        </Field>
        <Field label="From idea" name="idea_id" hint="Optional. Links the post to an idea so the pipeline stays accurate.">
          <Select defaultValue="">
            <option value="">Not linked</option>
            {ideas.map((i) => (
              <option key={i.id} value={i.id}>
                {truncate(i.hook, 60) || 'Untitled idea'}
                {i.platform ? ` (${i.platform})` : ''}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Notes" name="notes">
        <Input maxLength={500} />
      </Field>
      <SubmitButton size="sm" pendingLabel="Adding…">
        Add post
      </SubmitButton>
    </ActionForm>
  );
}
