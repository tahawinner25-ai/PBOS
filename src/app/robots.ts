import type { MetadataRoute } from 'next';
import { siteUrl } from '@/lib/env';

/** Pages that exist only for a signed-in creator, the demo workspace, auth flows and APIs. They never belong in search results. */
export const PRIVATE_PATHS = [
  '/api/',
  '/auth/',
  '/login',
  '/signup',
  '/onboarding',
  '/preview',
  '/dashboard',
  '/ideas',
  '/analytics',
  '/deals',
  '/revenue',
  '/settings',
  '/publish',
  '/agent',
  '/library',
  '/ads',
  '/studio',
  '/connections',
  '/demo/workspace',
  '/demo/ended',
] as const;

export const PUBLIC_PATHS = ['/', '/demo', '/blog', '/work-with-me', '/privacy', '/terms', '/cookies', '/security', '/data-deletion', '/accessibility'] as const;

export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: [{ userAgent: '*', allow: [...PUBLIC_PATHS], disallow: [...PRIVATE_PATHS] }],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
