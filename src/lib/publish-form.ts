import type { JobFormat, Platform, Privacy } from './integrations/types';

/** Turns the composer's FormData into plain values. Pure, so it is tested without a server. */

export const DESTINATIONS: Array<{ value: string; platform: Platform; format: JobFormat; label: string }> = [
  { value: 'youtube:video', platform: 'youtube', format: 'video', label: 'YouTube video' },
  { value: 'youtube:short', platform: 'youtube', format: 'short', label: 'YouTube Short' },
  { value: 'instagram:reel', platform: 'instagram', format: 'reel', label: 'Instagram Reel' },
  { value: 'instagram:photo', platform: 'instagram', format: 'photo', label: 'Instagram photo' },
  { value: 'instagram:carousel', platform: 'instagram', format: 'carousel', label: 'Instagram carousel' },
];

export type ComposerValues = {
  destinations: Array<{ platform: Platform; format: JobFormat }>;
  title: string;
  caption: string;
  tags: string[];
  privacy: Privacy;
  madeForKids: boolean | null;
  scheduledFor: string | null;
  mediaIds: string[];
  ideaId: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const str = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');

export function parseComposer(form: FormData): { ok: true; value: ComposerValues } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};

  const picked = [...new Set(form.getAll('destinations').map(str))];
  const destinations = picked.map((v) => DESTINATIONS.find((d) => d.value === v)).filter((d): d is (typeof DESTINATIONS)[number] => Boolean(d));
  if (picked.length !== destinations.length) errors.destinations = 'One of the destinations is not supported.';
  else if (destinations.length === 0) errors.destinations = 'Choose at least one place to post.';
  else if (destinations.filter((d) => d.platform === 'youtube').length > 1) errors.destinations = 'Choose either a YouTube video or a Short, not both.';
  else if (destinations.filter((d) => d.platform === 'instagram').length > 1) errors.destinations = 'Choose one Instagram format.';

  const privacyRaw = str(form.get('privacy')) || 'private';
  const privacy: Privacy = privacyRaw === 'public' || privacyRaw === 'unlisted' || privacyRaw === 'private' ? privacyRaw : 'private';
  if (privacy !== privacyRaw) errors.privacy = 'Choose public, unlisted or private.';

  const kids = str(form.get('made_for_kids'));
  const madeForKids = kids === 'yes' ? true : kids === 'no' ? false : null;

  const tags = str(form.get('tags')).split(',').map((t) => t.trim()).filter(Boolean).slice(0, 40);

  const scheduledRaw = str(form.get('scheduled_for')).trim();
  let scheduledFor: string | null = null;
  if (scheduledRaw) {
    const t = Date.parse(scheduledRaw);
    if (Number.isNaN(t)) errors.scheduledFor = 'That date and time is not valid.';
    else scheduledFor = new Date(t).toISOString();
  }

  const mediaIds = form.getAll('media_ids').map(str).filter(Boolean);
  if (mediaIds.some((id) => !UUID.test(id))) errors.media = 'One of the selected files is not valid.';
  if (mediaIds.length > 10) errors.media = 'Select at most 10 files.';

  const idea = str(form.get('idea_id'));
  if (idea && !UUID.test(idea)) errors.ideaId = 'That idea is not valid.';

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { destinations: destinations.map((d) => ({ platform: d.platform, format: d.format })), title: str(form.get('title')), caption: str(form.get('caption')), tags, privacy, madeForKids, scheduledFor, mediaIds, ideaId: idea || null } };
}

/** Plain-language summary shown in the approval dialog: exactly what will be posted, where, and when. */
export function describeApproval(job: { platform: Platform; format: JobFormat; title: string | null; caption: string | null; privacy: Privacy; scheduled_for: string | null; media_asset_ids: string[] }, now = new Date()): string {
  const where = job.platform === 'youtube' ? (job.format === 'short' ? 'a YouTube Short' : 'a YouTube video') : `an Instagram ${job.format}`;
  const when = job.scheduled_for && Date.parse(job.scheduled_for) > now.getTime() ? `at ${new Date(job.scheduled_for).toUTCString()}` : 'right away';
  const vis = job.platform === 'youtube' ? ` Visibility: ${job.privacy}.` : '';
  const what = job.title ? `“${job.title}”` : job.caption ? `“${job.caption.slice(0, 60)}${job.caption.length > 60 ? '…' : ''}”` : 'this post';
  return `PBOS will publish ${what} as ${where} ${when}.${vis} You can cancel until it starts uploading.`;
}
