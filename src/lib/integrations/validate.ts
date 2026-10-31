import type { JobFormat, MediaAssetRow, Platform, Privacy } from './types';
import { YOUTUBE_DESCRIPTION_MAX_BYTES, YOUTUBE_TAGS_MAX_CHARS, YOUTUBE_TITLE_MAX } from './youtube';

/**
 * Validation for a publish job. Pure, so the same rules run in the form, the server action that
 * saves it and the server action that approves it.
 *
 * Limits come from the platforms' documentation: YouTube title 100 characters, description 5,000
 * bytes, tags 500 characters in total, no angle brackets; Instagram caption 2,200 characters, JPEG
 * photos only, carousels of 2 to 10 items, one video for a Reel. The platform's API stays the final
 * judge: these checks exist to give an early, specific message instead of a failed upload.
 */

export const INSTAGRAM_CAPTION_MAX = 2200;
export const INSTAGRAM_HASHTAG_MAX = 30;
export const CAROUSEL_MIN = 2;
export const CAROUSEL_MAX = 10;
export const MIN_SCHEDULE_LEAD_MS = 5 * 60_000;
export const MAX_SCHEDULE_AHEAD_MS = 180 * 86_400_000;

export const YOUTUBE_VIDEO_MIME = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska', 'video/x-msvideo'];
export const INSTAGRAM_VIDEO_MIME = ['video/mp4', 'video/quicktime'];

export type JobInput = {
  platform: Platform;
  format: JobFormat;
  title?: string | null;
  caption?: string | null;
  tags?: string[] | null;
  privacy?: Privacy | null;
  madeForKids?: boolean | null;
  scheduledFor?: string | null;
  mediaAssetIds?: string[] | null;
  ideaId?: string | null;
};

export type NormalizedJob = {
  platform: Platform;
  format: JobFormat;
  title: string | null;
  caption: string | null;
  tags: string[];
  privacy: Privacy;
  madeForKids: boolean | null;
  scheduledFor: string | null;
  mediaAssetIds: string[];
  ideaId: string | null;
  /** True when any attached image or video was AI-generated. Sent to Instagram as is_ai_generated. */
  containsAi: boolean;
};

export type ValidationResult =
  | { ok: true; value: NormalizedJob; warnings: string[] }
  | { ok: false; errors: Record<string, string> };

const FORMATS: Record<Platform, JobFormat[]> = { youtube: ['video', 'short'], instagram: ['reel', 'photo', 'carousel'] };
const PRIVACY: Privacy[] = ['public', 'unlisted', 'private'];
const hasAngleBrackets = (s: string) => /[<>]/.test(s);

export function normalizeTags(tags: string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags ?? []) {
    const tag = raw.trim().replace(/^#+/, '').replace(/\s+/g, ' ');
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/** YouTube counts the length of the tag list including quotes around tags with spaces. */
export function youtubeTagsLength(tags: string[]): number {
  return tags.reduce((sum, t) => sum + t.length + (t.includes(' ') ? 2 : 0), 0) + Math.max(tags.length - 1, 0);
}

/** Instagram feed photos must be between 4:5 and 1.91:1. Unknown sizes pass here and are left for Instagram to judge. */
export function instagramRatioProblem(a: Pick<MediaAssetRow, 'width' | 'height'>): boolean {
  if (!a.width || !a.height) return false;
  const r = a.width / a.height;
  return r < 0.8 - 1e-9 || r > 1.91 + 1e-9;
}

export function validateJob(input: JobInput, media: MediaAssetRow[], now: Date, stage: 'draft' | 'approve'): ValidationResult {
  const errors: Record<string, string> = {};
  const warnings: string[] = [];
  const approving = stage === 'approve';

  if (!FORMATS[input.platform]?.includes(input.format)) errors.format = `${input.platform === 'youtube' ? 'YouTube' : 'Instagram'} does not support the format "${input.format}".`;

  const title = (input.title ?? '').trim();
  const caption = (input.caption ?? '').trim();
  const tags = normalizeTags(input.tags);
  const privacy: Privacy = input.platform === 'instagram' ? 'public' : (input.privacy ?? 'private');
  if (!PRIVACY.includes(privacy)) errors.privacy = 'Choose public, unlisted or private.';

  if (input.platform === 'youtube') {
    if (approving && !title) errors.title = 'A YouTube video needs a title.';
    if (title.length > YOUTUBE_TITLE_MAX) errors.title = `The title is ${title.length} characters. YouTube allows ${YOUTUBE_TITLE_MAX}.`;
    if (hasAngleBrackets(title)) errors.title = 'YouTube titles cannot contain < or >.';
    const bytes = Buffer.byteLength(caption, 'utf8');
    if (bytes > YOUTUBE_DESCRIPTION_MAX_BYTES) errors.caption = `The description is ${bytes} bytes. YouTube allows ${YOUTUBE_DESCRIPTION_MAX_BYTES}.`;
    if (hasAngleBrackets(caption)) errors.caption = 'YouTube descriptions cannot contain < or >.';
    if (youtubeTagsLength(tags) > YOUTUBE_TAGS_MAX_CHARS) errors.tags = `Tags are too long in total. YouTube allows ${YOUTUBE_TAGS_MAX_CHARS} characters.`;
    if (tags.some(hasAngleBrackets)) errors.tags = 'Tags cannot contain < or >.';
    if (approving && typeof input.madeForKids !== 'boolean') errors.madeForKids = 'Say whether this video is made for kids. YouTube requires an answer.';
  } else {
    if (caption.length > INSTAGRAM_CAPTION_MAX) errors.caption = `The caption is ${caption.length} characters. Instagram allows ${INSTAGRAM_CAPTION_MAX}.`;
    const hashtags = (caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
    if (hashtags > INSTAGRAM_HASHTAG_MAX) errors.caption = `The caption has ${hashtags} hashtags. Instagram allows ${INSTAGRAM_HASHTAG_MAX}.`;
    if (title) warnings.push('Instagram has no title field; the title is kept in PBOS only.');
  }

  let scheduledFor: string | null = null;
  if (input.scheduledFor) {
    const at = Date.parse(input.scheduledFor);
    if (Number.isNaN(at)) errors.scheduledFor = 'That date and time is not valid.';
    else if (at < now.getTime() + MIN_SCHEDULE_LEAD_MS) errors.scheduledFor = 'Pick a time at least 5 minutes from now.';
    else if (at > now.getTime() + MAX_SCHEDULE_AHEAD_MS) errors.scheduledFor = 'Pick a time within the next 180 days.';
    else scheduledFor = new Date(at).toISOString();
  }

  const ids = [...new Set(input.mediaAssetIds ?? [])];
  const assets = ids.map((id) => media.find((m) => m.id === id));
  if (assets.some((a) => !a)) errors.media = 'One of the selected files no longer exists.';
  const found = assets.filter((a): a is MediaAssetRow => Boolean(a));

  if (input.platform === 'youtube') {
    if (ids.length > 0) errors.media = 'YouTube videos are uploaded straight from your computer when you publish. Do not attach library files.';
  } else if (!errors.media) {
    if (input.format === 'photo') {
      if (approving || ids.length) {
        if (found.length !== 1) errors.media = 'An Instagram photo needs exactly one image.';
        else if (found[0].kind !== 'image' || found[0].mime_type !== 'image/jpeg') errors.media = 'Instagram accepts JPEG photos only. Export the image as JPEG and upload it again.';
        else if (instagramRatioProblem(found[0])) errors.media = 'Instagram feed photos must be between 4:5 (portrait) and 1.91:1 (wide). This image is outside that range. Crop it or generate a square or landscape version.';
      }
    } else if (input.format === 'reel') {
      if (approving || ids.length) {
        if (found.length !== 1) errors.media = 'A Reel needs exactly one video.';
        else if (found[0].kind !== 'video' || !INSTAGRAM_VIDEO_MIME.includes(found[0].mime_type)) errors.media = 'A Reel needs an MP4 or MOV video.';
      }
    } else if (input.format === 'carousel') {
      if (approving || ids.length) {
        if (found.length < CAROUSEL_MIN || found.length > CAROUSEL_MAX) errors.media = `A carousel needs ${CAROUSEL_MIN} to ${CAROUSEL_MAX} items.`;
        else if (found.some((a) => a.kind === 'image' && a.mime_type !== 'image/jpeg')) errors.media = 'Carousel photos must be JPEG.';
        else if (found.some((a) => a.kind === 'image' && instagramRatioProblem(a))) errors.media = 'Carousel photos must be between 4:5 and 1.91:1. One of the images is outside that range.';
        else if (found.some((a) => a.kind === 'video' && !INSTAGRAM_VIDEO_MIME.includes(a.mime_type))) errors.media = 'Carousel videos must be MP4 or MOV.';
      }
    }
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    warnings,
    value: {
      platform: input.platform,
      format: input.format,
      title: title || null,
      caption: caption || null,
      tags,
      privacy,
      madeForKids: typeof input.madeForKids === 'boolean' ? input.madeForKids : null,
      scheduledFor,
      mediaAssetIds: ids,
      ideaId: input.ideaId ?? null,
      containsAi: found.some((a) => a.ai_generated),
    },
  };
}
