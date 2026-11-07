/**
 * What is switched on in this deployment, in plain words, with the one next step when something is off. Built from
 * which settings exist, never from their values, so it is safe to show to the signed-in owner.
 */
export type StatusInput = {
  aiKey: boolean;
  aiProvider: 'gemini-compatible' | 'anthropic' | null;
  openaiImageKey: boolean;
  storageReady: boolean;
  cronSecret: boolean;
  siteUrl: boolean;
};

export type StatusRow = { key: string; label: string; ok: boolean; detail: string };

export function buildSystemStatus(i: StatusInput): StatusRow[] {
  return [
    {
      key: 'ai',
      label: 'AI (agent, drafts, ads, daily review)',
      ok: i.aiKey,
      detail: i.aiKey ? (i.aiProvider === 'anthropic' ? 'On, using Anthropic. Web search is available.' : 'On, using the AI_API_KEY provider (Gemini by default). Web search is not available with it.') : 'Off. Add AI_API_KEY (a free Gemini key from aistudio.google.com/apikey) in Vercel, then redeploy.',
    },
    {
      key: 'images',
      label: 'Image generation',
      ok: true,
      detail: i.openaiImageKey ? 'On. OpenAI first, with a free fallback.' : 'On, using the free image service (about one image per 45 seconds, shared). Add POLLINATIONS_API_KEY to lift the shared limit.',
    },
    {
      key: 'storage',
      label: 'File storage (uploads and generated images)',
      ok: i.storageReady,
      detail: i.storageReady ? 'On.' : 'Off. SUPABASE_SERVICE_ROLE_KEY is missing or is the public anon key. Copy the service_role secret from Supabase → Project Settings → API Keys.',
    },
    {
      key: 'cron',
      label: 'Scheduled jobs (scheduled posts, analytics sync)',
      ok: i.cronSecret,
      detail: i.cronSecret ? 'Secret set. Jobs run when the GitHub schedule calls the app (needs the PBOS_URL and CRON_SECRET GitHub secrets).' : 'Off. Set CRON_SECRET in Vercel and the same value as a GitHub secret.',
    },
    {
      key: 'site',
      label: 'Public address (sign-in redirects)',
      ok: i.siteUrl,
      detail: i.siteUrl ? 'Set.' : 'Missing NEXT_PUBLIC_SITE_URL. YouTube and Gmail connections need it.',
    },
  ];
}
