import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BlogBody } from '@/components/blog-body';
import { PublicShell } from '@/components/public-shell';
import { Button } from '@/components/ui/button';
import { siteUrl } from '@/lib/env';
import { BLOG_AUTHOR, findPost, formatPostDate, neighbours, POSTS, readingMinutes } from '@/lib/blog';

type Props = { params: { slug: string } };

export function generateStaticParams() {
  return POSTS.map((p) => ({ slug: p.slug }));
}

export function generateMetadata({ params }: Props): Metadata {
  const post = findPost(params.slug);
  if (!post) return { title: 'Post not found' };
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: { type: 'article', title: post.title, description: post.description, publishedTime: post.date, authors: [BLOG_AUTHOR] },
  };
}

export default function BlogPostPage({ params }: Props) {
  const post = findPost(params.slug);
  if (!post) notFound();
  const { newer, older } = neighbours(post.slug);
  const base = siteUrl();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    dateModified: post.date,
    author: { '@type': 'Organization', name: BLOG_AUTHOR },
    publisher: { '@type': 'Organization', name: 'PBOS' },
    mainEntityOfPage: `${base}/blog/${post.slug}`,
  };

  return (
    <PublicShell>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <main id="main" tabIndex={-1} className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
        <p className="mb-6 text-sm">
          <Link href="/blog" className="text-muted-foreground underline underline-offset-4 hover:text-foreground">
            All posts
          </Link>
        </p>
        <article>
          <header className="mb-8">
            <h1 className="mb-3">{post.title}</h1>
            <p className="text-sm text-muted-foreground">
              <time dateTime={post.date}>{formatPostDate(post.date)}</time>
              <span aria-hidden="true"> · </span>
              <span>{readingMinutes(post)} min read</span>
              <span aria-hidden="true"> · </span>
              <span>{BLOG_AUTHOR}</span>
            </p>
          </header>
          <BlogBody blocks={post.blocks} />
        </article>

        <nav aria-label="More posts" className="mt-14 grid gap-4 border-t border-border pt-6 text-sm sm:grid-cols-2">
          {older ? (
            <Link href={`/blog/${older.slug}`} className="rounded-md border border-border p-4 hover:bg-muted/50">
              <span className="block text-xs text-muted-foreground">Older post</span>
              <span className="font-medium">{older.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {newer ? (
            <Link href={`/blog/${newer.slug}`} className="rounded-md border border-border p-4 hover:bg-muted/50 sm:text-right">
              <span className="block text-xs text-muted-foreground">Newer post</span>
              <span className="font-medium">{newer.title}</span>
            </Link>
          ) : null}
        </nav>

        <section aria-labelledby="try" className="mt-10 rounded-lg border border-border bg-muted/40 p-6">
          <h2 id="try" className="mb-2 text-xl">
            See it for yourself
          </h2>
          <p className="mb-4 max-w-prose text-sm text-muted-foreground">The demo is a sample workspace with a ten-minute timer. No account needed.</p>
          <Button asChild>
            <Link href="/demo">Try the demo</Link>
          </Button>
        </section>
      </main>
    </PublicShell>
  );
}
