import { rssXml } from '@/lib/blog';
import { siteUrl } from '@/lib/env';

export const dynamic = 'force-static';
export const revalidate = 3600;

export function GET() {
  return new Response(rssXml(siteUrl()), {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600, s-maxage=3600' },
  });
}
