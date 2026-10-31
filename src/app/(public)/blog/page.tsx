import type { Metadata } from 'next';
import Link from 'next/link';
import { Rss } from 'lucide-react';
import { PublicShell } from '@/components/public-shell';
import { BLOG_AUTHOR, formatPostDate, readingMinutes, sortedPosts } from '@/lib/blog';

export const metadata: Metadata = {
  title: 'Blog',
  description: 'How PBOS works, which permissions it asks for, and what it will not do. Written by the people building it.',
  alternates: { canonical: '/blog', types: { 'application/rss+xml': '/blog/rss.xml' } },
};

export default function BlogIndex() {
  const posts = sortedPosts();
  return (
    <PublicShell>
      <main id="main" tabIndex={-1} className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
        <h1 className="mb-2">The PBOS blog</h1>
        <p className="mb-2 max-w-prose text-lg text-muted-foreground">How the product works, what it asks for, and what it will not do.</p>
        <p className="mb-10 text-sm">
          <Link href="/blog/rss.xml" className="inline-flex items-center gap-1.5 text-muted-foreground underline underline-offset-4 hover:text-foreground">
            <Rss aria-hidden="true" className="size-4" />
            RSS feed
          </Link>
        </p>

        <ul className="ledger" aria-label="Posts">
          {posts.map((p) => (
            <li key={p.slug} className="py-6">
              <article>
                <h2 className="mb-1 text-2xl">
                  <Link href={`/blog/${p.slug}`} className="underline-offset-4 hover:underline">
                    {p.title}
                  </Link>
                </h2>
                <p className="mb-2 text-sm text-muted-foreground">
                  <time dateTime={p.date}>{formatPostDate(p.date)}</time>
                  <span aria-hidden="true"> · </span>
                  <span>{readingMinutes(p)} min read</span>
                  <span aria-hidden="true"> · </span>
                  <span>{BLOG_AUTHOR}</span>
                </p>
                <p className="max-w-prose text-muted-foreground">{p.description}</p>
              </article>
            </li>
          ))}
        </ul>
      </main>
    </PublicShell>
  );
}
