import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MediaKitView } from '@/components/media-kit-view';
import { PublicShell } from '@/components/public-shell';
import { Alert } from '@/components/ui/alert';
import { contactEmail, siteUrl } from '@/lib/env';
import { loadPublicKit } from '@/lib/server/public';

// The page reads the database through fetch, so give it a short revalidation window.
// Publishing or editing in Settings also revalidates this path immediately.
export const revalidate = 60;

export async function generateMetadata(): Promise<Metadata> {
  const kit = await loadPublicKit();
  if (kit.state !== 'ok') {
    return { title: 'Work with me', robots: { index: false, follow: false } };
  }
  const { profile } = kit;
  const title = `Work with ${profile.name}`;
  const description = profile.positioning ?? (profile.niche ? `${profile.name} creates content about ${profile.niche}. See collaboration options and get in touch.` : `Collaboration options and contact details for ${profile.name}.`);
  return {
    title,
    description,
    alternates: { canonical: '/work-with-me' },
    robots: { index: true, follow: true },
    openGraph: { type: 'website', siteName: 'PBOS', title, description, url: '/work-with-me' },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function WorkWithMePage() {
  const kit = await loadPublicKit();
  if (kit.state === 'unpublished') notFound();

  if (kit.state === 'unavailable') {
    return (
      <PublicShell>
        <main id="main" tabIndex={-1} className="mx-auto max-w-xl px-4 py-16">
          <h1 className="mb-4">This page is not available right now</h1>
          <Alert variant="warning" title="The media kit could not be loaded.">
            Please try again in a few minutes. <Link href="/">Back to the home page</Link>
          </Alert>
        </main>
      </PublicShell>
    );
  }

  const { profile, proof } = kit;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: profile.name,
    ...(profile.positioning ? { description: profile.positioning } : {}),
    ...(profile.niche ? { knowsAbout: profile.niche } : {}),
    ...(profile.avatar_url ? { image: profile.avatar_url } : {}),
    url: `${siteUrl()}/work-with-me`,
  };

  return (
    <PublicShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <main id="main" tabIndex={-1}>
        <MediaKitView profile={profile} proof={proof} contactEmail={contactEmail()} />
      </main>
    </PublicShell>
  );
}
