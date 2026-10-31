import type { MetadataRoute } from 'next';
import { POSTS } from '@/lib/blog';
import { siteUrl } from '@/lib/env';
import { resolvePublicCreator } from '@/lib/server/public';

// The media kit appears only while it is published, so this is read per request.
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const entries: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: 'monthly', priority: 1 },
    { url: `${base}/demo`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/blog`, changeFrequency: 'weekly', priority: 0.7 },
    ...POSTS.map((p) => ({ url: `${base}/blog/${p.slug}`, lastModified: new Date(`${p.date}T12:00:00Z`), changeFrequency: 'yearly' as const, priority: 0.6 })),
    { url: `${base}/privacy`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/terms`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/cookies`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${base}/security`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/data-deletion`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/accessibility`, changeFrequency: 'yearly', priority: 0.3 },
  ];
  try {
    const creator = await resolvePublicCreator();
    if (typeof creator === 'object') entries.splice(1, 0, { url: `${base}/work-with-me`, changeFrequency: 'weekly', priority: 0.8 });
  } catch {
    // If the database is unreachable the sitemap still lists the static pages.
  }
  return entries;
}
