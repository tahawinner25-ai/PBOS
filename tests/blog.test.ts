import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { escapeXml, findPost, formatPostDate, neighbours, POSTS, postText, readingMinutes, rssXml, sortedPosts } from '../src/lib/blog';

describe('blog posts', () => {
  it('have unique, URL-safe slugs and valid ISO dates not in the future', () => {
    const slugs = POSTS.map((p) => p.slug);
    assert.equal(new Set(slugs).size, slugs.length);
    const today = new Date().toISOString().slice(0, 10);
    for (const p of POSTS) {
      assert.match(p.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, p.slug);
      assert.match(p.date, /^\d{4}-\d{2}-\d{2}$/, p.slug);
      assert.ok(!Number.isNaN(Date.parse(p.date)), p.slug);
      assert.ok(p.date <= today, `${p.slug} is dated in the future`);
    }
  });

  it('have titles and descriptions of useful length for search results', () => {
    for (const p of POSTS) {
      assert.ok(p.title.length >= 10 && p.title.length <= 80, `${p.slug} title ${p.title.length}`);
      assert.ok(p.description.length >= 70 && p.description.length <= 200, `${p.slug} description ${p.description.length}`);
      assert.ok(p.blocks.length >= 4, p.slug);
    }
  });

  it('only link to same-site paths that exist', () => {
    const known = new Set(['/demo', '/privacy', '/signup', ...POSTS.map((p) => `/blog/${p.slug}`)]);
    for (const p of POSTS) {
      for (const b of p.blocks) {
        if (b.type !== 'link') continue;
        assert.match(b.href, /^\/[a-z0-9/-]*$/, `${p.slug}: ${b.href}`);
        assert.ok(known.has(b.href), `${p.slug} links to unknown ${b.href}`);
      }
    }
  });

  it('contain no markup, no invented statistics and no outcome promises', () => {
    for (const p of POSTS) {
      const text = `${p.title} ${p.description} ${postText(p)}`;
      assert.doesNotMatch(text, /<[a-z/][^>]*>/i, `${p.slug} contains markup`);
      assert.doesNotMatch(text, /\b\d{1,3}(?:,\d{3})+\s+(?:creators|users|customers)\b/i, `${p.slug} claims a user count`);
      assert.doesNotMatch(text, /(?<!not )\b(?:guaranteed? (?:growth|income|results|reach)|10x|go viral|grow your (?:audience|following) (?:fast|by))\b/i, `${p.slug} promises an outcome`);
      assert.doesNotMatch(text, /\b(?:trusted by|loved by|used by)\b/i, `${p.slug} claims social proof`);
    }
  });

  it('sorts newest first and finds neighbours', () => {
    const sorted = sortedPosts();
    for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i - 1].date >= sorted[i].date);
    const first = sorted[0];
    const n = neighbours(first.slug);
    assert.equal(n.newer, null);
    assert.equal(n.older?.slug, sorted[1].slug);
    assert.deepEqual(neighbours('missing'), { newer: null, older: null });
    assert.equal(findPost('missing'), undefined);
  });

  it('computes reading time and dates', () => {
    for (const p of POSTS) assert.ok(readingMinutes(p) >= 1 && readingMinutes(p) <= 10, p.slug);
    assert.equal(formatPostDate('2026-10-19'), 'October 19, 2026');
  });
});

describe('rss feed', () => {
  it('is well formed, escapes text and lists every post once', () => {
    const xml = rssXml('https://example.com');
    assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
    assert.equal((xml.match(/<item>/g) ?? []).length, POSTS.length);
    for (const p of POSTS) assert.ok(xml.includes(`https://example.com/blog/${p.slug}`));
    assert.doesNotMatch(xml, /&(?!amp;|lt;|gt;|quot;|apos;)/, 'unescaped ampersand');
  });
  it('escapes XML characters', () => {
    assert.equal(escapeXml(`<a href="x">Tom & 'Jerry'</a>`), '&lt;a href=&quot;x&quot;&gt;Tom &amp; &apos;Jerry&apos;&lt;/a&gt;');
  });
});
