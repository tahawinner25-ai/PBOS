export type PlatformGuide = { max: number; guidance: string };

/** Tone, length and structure guidance per platform. `max` is a hard limit enforced by the validator. */
export const PLATFORM_GUIDE: Record<string, PlatformGuide> = {
  Instagram: {
    max: 2200,
    guidance:
      'Warm and visual-first. Open with a line that works before the "more" cut. Short paragraphs with line breaks. End with one question or one call to action. Hashtags are optional and should be few.',
  },
  TikTok: {
    max: 300,
    guidance: 'Punchy and conversational, written the way you would say it. One or two lines that complement the video, plus one light call to action.',
  },
  YouTube: {
    max: 1000,
    guidance: 'First line reads like a title. Then a short description that says what the viewer will learn. Plain and specific.',
  },
  LinkedIn: {
    max: 1300,
    guidance: 'Professional but personal. Strong first line, short paragraphs, one practical takeaway, end with a question.',
  },
  X: {
    max: 280,
    guidance: 'One tight idea in a single post. No filler. No hashtags unless essential.',
  },
  Newsletter: {
    max: 1500,
    guidance: 'First line is the subject line. Then a short intro paragraph that earns the open and names what the issue covers.',
  },
  Podcast: {
    max: 800,
    guidance: 'Episode description: what the episode covers and who it is for, in plain language.',
  },
  Other: {
    max: 1000,
    guidance: 'Clear, plain and specific to the channel.',
  },
};

export function platformGuide(platform: string | null | undefined): PlatformGuide & { name: string } {
  const key = Object.keys(PLATFORM_GUIDE).find((k) => k.toLowerCase() === (platform ?? '').toLowerCase()) ?? 'Other';
  return { name: key, ...PLATFORM_GUIDE[key] };
}
