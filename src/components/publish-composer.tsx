'use client';

import { useMemo, useState } from 'react';
import { saveDrafts } from '@/actions/publish';
import { ActionForm, Field, SubmitButton } from '@/components/action-form';
import { MediaUploader } from '@/components/media-uploader';
import { Alert } from '@/components/ui/alert';
import { Input, Select, Textarea } from '@/components/ui/input';
import { DESTINATIONS } from '@/lib/publish-form';
import type { MediaAssetRow } from '@/lib/integrations/types';
import { INSTAGRAM_CAPTION_MAX } from '@/lib/integrations/validate';
import { YOUTUBE_TITLE_MAX } from '@/lib/integrations/youtube';

type Media = Pick<MediaAssetRow, 'id' | 'kind' | 'mime_type' | 'label' | 'ai_generated' | 'storage_path'> & { previewUrl: string | null };
type Idea = { id: string; hook: string | null };

/** Local "yyyy-MM-ddTHH:mm" from a datetime-local input becomes an absolute ISO time in the creator's own time zone. */
function toIso(local: string): string {
  const t = new Date(local);
  return Number.isNaN(t.getTime()) ? '' : t.toISOString();
}

export function PublishComposer({ connected, media, ideas }: { connected: { youtube: boolean; instagram: boolean }; media: Media[]; ideas: Idea[] }) {
  const [dest, setDest] = useState<string[]>([]);
  const [caption, setCaption] = useState('');
  const [local, setLocal] = useState('');
  const hasYoutube = dest.some((d) => d.startsWith('youtube:'));
  const hasInstagram = dest.some((d) => d.startsWith('instagram:'));
  const igFormat = dest.find((d) => d.startsWith('instagram:'))?.split(':')[1];
  const minLocal = useMemo(() => new Date(Date.now() + 6 * 60_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16), []);

  function toggle(value: string, on: boolean) {
    setDest((prev) => {
      const platform = value.split(':')[0];
      const rest = prev.filter((d) => d !== value && !(on && d.startsWith(`${platform}:`)));
      return on ? [...rest, value] : rest;
    });
  }

  return (
    <ActionForm action={saveDrafts} resetOnSuccess className="space-y-6" onSuccess={() => { setDest([]); setCaption(''); setLocal(''); }}>
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">Where do you want to post?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {DESTINATIONS.map((d) => {
            const available = connected[d.platform];
            return (
              <label key={d.value} className={`flex items-start gap-3 rounded-md border border-border p-3 text-sm ${available ? 'cursor-pointer hover:bg-accent/50' : 'opacity-60'}`}>
                <input type="checkbox" name="destinations" value={d.value} className="mt-0.5 size-4" disabled={!available} checked={dest.includes(d.value)} onChange={(e) => toggle(d.value, e.target.checked)} />
                <span>{d.label}{!available ? <span className="block text-xs text-muted-foreground">Connect {d.platform === 'youtube' ? 'YouTube' : 'Instagram'} first</span> : null}</span>
              </label>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">One YouTube format and one Instagram format per post. Choose both to publish the same idea to both places; each gets its own draft.</p>
      </fieldset>

      {hasYoutube ? (
        <Field label="Title" name="title" hint={`YouTube titles are up to ${YOUTUBE_TITLE_MAX} characters.`} required>
          <Input maxLength={YOUTUBE_TITLE_MAX} />
        </Field>
      ) : null}
      <Field label={hasYoutube && !hasInstagram ? 'Description' : 'Caption'} name="caption" hint={hasInstagram ? `Instagram allows ${INSTAGRAM_CAPTION_MAX} characters and up to 30 hashtags. ${caption.length}/${INSTAGRAM_CAPTION_MAX}` : 'Up to 5,000 bytes. Links are fine; angle brackets are not.'}>
        <Textarea rows={5} value={caption} onChange={(e) => setCaption(e.target.value)} />
      </Field>
      {hasYoutube ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Tags" name="tags" hint="Comma separated."><Input placeholder="creator tips, workflow" /></Field>
          <Field label="Visibility" name="privacy" hint="Start private if you want to check it on YouTube first."><Select defaultValue="private"><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></Select></Field>
          <Field label="Made for kids?" name="made_for_kids" hint="YouTube requires an answer."><Select defaultValue=""><option value="">Choose…</option><option value="no">No</option><option value="yes">Yes</option></Select></Field>
        </div>
      ) : null}

      {hasInstagram ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Instagram media{igFormat === 'carousel' ? ' (2 to 10, in order)' : igFormat === 'reel' ? ' (one MP4 or MOV video)' : igFormat === 'photo' ? ' (one JPEG image)' : ''}</legend>
          {media.length === 0 ? <p className="text-sm text-muted-foreground">Your library is empty. Upload a file to attach it.</p> : (
            <ul className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4">
              {media.map((m) => (
                <li key={m.id}>
                  <label className="flex cursor-pointer flex-col gap-1 rounded-md border border-border p-2 text-xs hover:bg-accent/50">
                    <span className="flex aspect-square items-center justify-center overflow-hidden rounded bg-muted">
                      {m.previewUrl && m.kind === 'image' ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={m.previewUrl} alt={m.label ?? 'Library image'} className="size-full object-cover" /> : <span className="px-1 text-center text-muted-foreground">{m.kind === 'video' ? 'Video' : 'Image'}</span>}
                    </span>
                    <span className="flex items-center gap-1.5"><input type="checkbox" name="media_ids" value={m.id} className="size-3.5" /><span className="truncate">{m.label ?? m.mime_type}</span></span>
                    {m.ai_generated ? <span className="text-muted-foreground">AI-generated · labelled on Instagram</span> : null}
                  </label>
                </li>
              ))}
            </ul>
          )}
          <MediaUploader compact />
        </fieldset>
      ) : null}
      {hasYoutube ? <Alert variant="info">You choose the YouTube video file after you approve the post. It uploads in the browser with a progress bar and can resume if the connection drops.</Alert> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Field label="Schedule (optional)" name="scheduled_for_local" hint="Leave empty to publish as soon as you approve. Your local time zone.">
            <Input type="datetime-local" min={minLocal} value={local} onChange={(e) => setLocal(e.target.value)} />
          </Field>
          <input type="hidden" name="scheduled_for" value={local ? toIso(local) : ''} />
        </div>
        <Field label="Linked idea (optional)" name="idea_id" hint="Marks the idea as posted once this goes out.">
          <Select defaultValue=""><option value="">None</option>{ideas.map((i) => <option key={i.id} value={i.id}>{(i.hook ?? 'Untitled idea').slice(0, 70)}</option>)}</Select>
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Saving draft…" disabled={dest.length === 0}>Save draft</SubmitButton>
        <p className="text-xs text-muted-foreground">Saving a draft sends nothing anywhere. You approve each post separately, below.</p>
      </div>
    </ActionForm>
  );
}
