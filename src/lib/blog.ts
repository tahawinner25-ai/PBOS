/**
 * The PBOS blog. Posts are typed data, not Markdown, so there is nothing to sanitise: every block renders as
 * plain text inside our own components. Rules for writing here (checked by tests/blog.test.ts):
 *   - describe what the product actually does today, never what it might do;
 *   - no statistics, customer counts or results unless they are real and sourced;
 *   - no promise of income, growth or reach;
 *   - links inside posts are same-site paths only.
 */

export type Block =
  | { type: 'h2'; text: string }
  | { type: 'p'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'note'; title: string; text: string }
  | { type: 'link'; href: string; label: string };

export type Post = {
  slug: string;
  title: string;
  description: string;
  /** ISO date, yyyy-mm-dd. */
  date: string;
  tags: string[];
  blocks: Block[];
};

export const BLOG_AUTHOR = 'The PBOS team';

export const POSTS: readonly Post[] = [
  {
    slug: 'why-we-are-building-pbos',
    title: 'Why we are building PBOS',
    description: 'Creators run a business out of five tabs. PBOS reads them for you, says what needs attention and why, and drafts the next move for you to approve.',
    date: '2026-10-19',
    tags: ['product'],
    blocks: [
      { type: 'p', text: 'A creator’s week is spread across tools that do not talk to each other: a notes app for ideas, each platform’s own dashboard for numbers, an inbox full of brand emails, a spreadsheet for invoices. The work that slips is rarely the creative work. It is the follow-up nobody remembered to send, the invoice that went overdue, the idea that never became a post.' },
      { type: 'p', text: 'PBOS is an operating system for that layer. It looks at what you enter or connect, notices what needs attention, tells you why, and drafts the next thing. You decide what happens.' },
      { type: 'h2', text: 'What we promise, and what we do not' },
      { type: 'ul', items: [
        'You approve everything. PBOS drafts and recommends; it does not publish, email or spend money on its own.',
        'It does not invent numbers. If a figure is missing, the screen says so and tells you how to add it.',
        'Every recommendation points at the record or the goal it came from, so you can check it.',
        'It does not promise growth, reach, brand deals or income. Forecasts are labelled as estimates.',
      ] },
      { type: 'note', title: 'We are early', text: 'PBOS is a new product. We would rather show you a small, honest tool than a large claim. This blog describes what the product does today.' },
      { type: 'link', href: '/demo', label: 'Try the 10-minute demo, no sign-up' },
    ],
  },
  {
    slug: 'the-daily-loop',
    title: 'The daily loop: scan, flag, suggest, draft, learn',
    description: 'How PBOS decides what to tell you each day, why plain rules make the call, and where the AI is allowed to help.',
    date: '2026-10-19',
    tags: ['product', 'ai'],
    blocks: [
      { type: 'p', text: 'Each review follows the same five steps. Knowing them tells you what PBOS will and will not do.' },
      { type: 'h2', text: 'Scan and flag' },
      { type: 'p', text: 'PBOS reads your ideas, posts, deals, invoices and connected accounts, and runs checks on them. The checks are plain rules, not a model’s opinion. One example: a deal that has sat in the same stage for more than a week with no close date set gets flagged. Another: an invoice past its due date.' },
      { type: 'h2', text: 'Suggest and draft' },
      { type: 'p', text: 'You see one to three suggested actions, each with the reason and the record it came from. For the most valuable one, PBOS drafts the asset: a follow-up email, a hook for an idea, a media kit paragraph. Drafts are text for you to edit. Nothing is sent.' },
      { type: 'h2', text: 'Where the AI fits' },
      { type: 'p', text: 'The rules decide what is flagged. The AI only words the finding and writes the draft. Before you see its answer, PBOS checks it against your records: names, amounts and dates must match what you entered. If the check fails, you get the rule-based wording instead, and the page says so.' },
      { type: 'h2', text: 'Learn' },
      { type: 'p', text: 'Accept or ignore each suggestion. If you ignore the same flag twice it is paused for 14 days, though it stays visible. Something you accepted is left alone for two days and raised again only if the data has not changed. Areas you act on rank a little higher. Whenever PBOS pauses or re-ranks something, it says so on your dashboard.' },
      { type: 'link', href: '/blog/why-we-are-building-pbos', label: 'Why we are building PBOS' },
    ],
  },
  {
    slug: 'nothing-is-published-until-you-approve-it',
    title: 'Nothing is published until you approve it',
    description: 'How approval works for YouTube and Instagram posts, and why an uncertain Instagram result is never retried automatically.',
    date: '2026-10-20',
    tags: ['publishing', 'safety'],
    blocks: [
      { type: 'p', text: 'You can prepare a YouTube video or an Instagram post in PBOS, with or without the AI agent’s help. A prepared post is a draft. The only way a draft becomes a scheduled or published post is you pressing approve on that specific post.' },
      { type: 'h2', text: 'What approval means' },
      { type: 'ul', items: [
        'The draft shows exactly what will be posted: title, caption, privacy setting, file and time.',
        'Approved content cannot be edited. To change it, cancel the post and make a new draft.',
        'The agent can prepare drafts for you. It cannot approve them.',
        'You can cancel a scheduled post before it goes out.',
      ] },
      { type: 'h2', text: 'When the outcome is uncertain' },
      { type: 'p', text: 'Networks fail in the middle. If Instagram does not confirm whether a post went live, retrying could publish it twice, which is worse than a delay. So PBOS marks the post “needs review”, shows you what it knows, and does not retry by itself. You check your profile and decide. For temporary failures where nothing was published, PBOS retries a limited number of times with growing delays, then marks the post failed so you can decide.' },
      { type: 'h2', text: 'Checks before anything is sent' },
      { type: 'p', text: 'PBOS checks the file type from its actual bytes rather than its name, and checks lengths and ratios against the platform’s rules before upload, so most problems appear as a message on the draft instead of a failed upload.' },
      { type: 'link', href: '/blog/connect-youtube-and-instagram', label: 'Connecting YouTube and Instagram' },
    ],
  },
  {
    slug: 'connect-youtube-and-instagram',
    title: 'Connecting YouTube and Instagram: what we ask for and why',
    description: 'The permissions PBOS requests from Google and Meta, what each one is used for, and how to disconnect and delete the data.',
    date: '2026-10-20',
    tags: ['integrations', 'privacy'],
    blocks: [
      { type: 'p', text: 'Connecting an account lets PBOS publish what you approve and read your analytics. We ask only for the permissions those two jobs need, and you can see them on the consent screen before you agree.' },
      { type: 'h2', text: 'YouTube (Google)' },
      { type: 'ul', items: [
        'Upload videos to your channel (youtube.upload): used only when you approve a video.',
        'View your channel and videos (youtube.readonly): used to show your channel and sync post details.',
        'View YouTube Analytics reports (yt-analytics.readonly): used to show your numbers.',
      ] },
      { type: 'h2', text: 'Instagram (Meta)' },
      { type: 'p', text: 'Instagram publishing works through a professional (Business or Creator) Instagram account linked to a Facebook Page. PBOS asks for instagram_basic, instagram_content_publish, instagram_manage_insights, pages_show_list and pages_read_engagement: to find the account, publish what you approve, read insights, and list the Page it is linked to.' },
      { type: 'h2', text: 'How the connection is stored' },
      { type: 'p', text: 'Access and refresh tokens are encrypted before they are saved, they are never sent to your browser, and the signed-in role cannot even read the token columns. The sign-in step uses a signed, short-lived state value and a PKCE challenge so a forged callback is rejected.' },
      { type: 'h2', text: 'Leaving' },
      { type: 'p', text: 'Disconnect at any time from the Connections page. PBOS asks Google or Meta to revoke its access and deletes the stored tokens, and you can choose to delete everything synced from that platform too. Deleting your account does all of this for every platform. You can also remove PBOS from your Google account’s third-party access page or from Instagram’s app settings.' },
      { type: 'note', title: 'Unverified apps', text: 'While an app is in testing with Google or in development mode with Meta, only listed test users can connect, and Google may show an “unverified app” warning. Public access needs each platform’s review. We will say here when that is done.' },
      { type: 'link', href: '/privacy', label: 'Read the privacy policy' },
    ],
  },
  {
    slug: 'why-instagram-posts-are-scheduled-differently',
    title: 'Why scheduled Instagram posts work differently from YouTube',
    description: 'YouTube can hold a video until a set time. Instagram’s publishing interface cannot, so PBOS has to send the post when the time comes.',
    date: '2026-10-21',
    tags: ['publishing', 'integrations'],
    blocks: [
      { type: 'p', text: 'If you schedule a YouTube video in PBOS, the video is uploaded straight away as private and YouTube itself publishes it at the time you chose. If your computer is off at that moment, nothing changes.' },
      { type: 'p', text: 'Instagram’s publishing interface has no equivalent. A post is created and then published; there is no “publish at this time” option. So for a scheduled Instagram post PBOS keeps the approved post and sends it when the time arrives, using a background job that runs on a timer.' },
      { type: 'h2', text: 'What that means for you' },
      { type: 'ul', items: [
        'A scheduled Instagram post goes out when the next background run after your chosen time happens, so it can be a little late. The Publish page shows the planned time and, once it is sent, when it was published.',
        'If the connection is no longer valid when the time comes, the post is not sent. It is marked as failed with the reason, and your dashboard tells you to reconnect.',
        'Your approval is for that exact content. To change the caption, cancel the post and make a new draft.',
      ] },
      { type: 'note', title: 'For people running their own copy', text: 'The timer is a scheduled call to the cron endpoint, protected by a secret. How often it runs depends on your hosting plan. The setup guide explains the options.' },
      { type: 'link', href: '/blog/nothing-is-published-until-you-approve-it', label: 'Nothing is published until you approve it' },
    ],
  },
  {
    slug: 'real-numbers-only',
    title: 'Real numbers only: how PBOS treats your analytics',
    description: 'Synced from your accounts or logged by you, never estimated. How PBOS labels partial data and what it does when a number is missing.',
    date: '2026-10-21',
    tags: ['analytics', 'product'],
    blocks: [
      { type: 'p', text: 'A made-up number is worse than no number, because you might act on it. PBOS follows one rule: every figure comes from your connected account or from something you typed, and nothing fills a gap with a guess.' },
      { type: 'h2', text: 'What that looks like' },
      { type: 'ul', items: [
        'Numbers pulled from YouTube and Instagram are labelled as synced, with the time of the last sync. Numbers you logged are labelled as yours.',
        'If a window is partial, for example the account is newer than the period shown, the page says how many days it actually covers.',
        'Reach is shown as a daily average where that is what the platform provides. It is not multiplied up to a month.',
        'A missing figure is shown as missing, with a prompt telling you what to log or which account to connect.',
        'The revenue forecast multiplies each open deal by a fixed stage probability and is always labelled “Estimate, not guaranteed income.”',
      ] },
      { type: 'h2', text: 'Why we do it this way' },
      { type: 'p', text: 'Recommendations are only as good as the data under them. If PBOS says one format outperforms another, you should be able to open the posts behind that claim. When there is not enough data, the useful answer is what to track next, and that is what you get.' },
      { type: 'link', href: '/blog/the-daily-loop', label: 'The daily loop' },
    ],
  },
  {
    slug: 'what-the-ai-does-and-does-not-do',
    title: 'What the AI does in PBOS, and what it does not',
    description: 'Wording and drafting, checked against your records, with images and ad copy held to guardrails. A plain description of the limits.',
    date: '2026-10-22',
    tags: ['ai', 'safety'],
    blocks: [
      { type: 'h2', text: 'What it does' },
      { type: 'ul', items: [
        'Words the findings the rules produce, and writes drafts: outreach emails, hooks, captions, media kit copy.',
        'Works inside the app when you ask: it reads your workspace and makes new ideas, scripts, publish drafts, images and ad copy. Each is logged and can be undone. Anything that would change an existing record waits for your approval. Numbers in its reply must appear in your data, and a reply that fails that check is replaced by a plain list of what was actually done.',
        'Generates images you ask for. They are saved to your library marked as AI-generated.',
        'Drafts ad copy that fits Meta and YouTube length limits.',
      ] },
      { type: 'h2', text: 'What it does not do' },
      { type: 'ul', items: [
        'Publish, approve a post, send email, pay, submit an ad or delete anything. It has no way to; those stay your own clicks.',
        'Make up metrics, audience details, testimonials or results.',
        'Promise outcomes, or write binding legal terms.',
        'Pretend to be a person. An AI persona on a public page is always labelled as AI.',
      ] },
      { type: 'h2', text: 'Who processes your data' },
      { type: 'p', text: 'When you ask for a draft or an answer, the fields needed for that task are sent to Anthropic’s API. Image generation sends your prompt to OpenAI’s Images API. The privacy policy lists each provider and what it receives.' },
      { type: 'note', title: 'AI can be wrong', text: 'Read and edit every draft. PBOS checks drafts against your records and its own rules, but a check cannot make a draft good or suitable for your audience. That judgement is yours.' },
      { type: 'link', href: '/blog/writing-ads-without-claims-you-cannot-prove', label: 'Writing ads without claims you cannot prove' },
    ],
  },
  {
    slug: 'writing-ads-without-claims-you-cannot-prove',
    title: 'Writing ads without claims you cannot prove',
    description: 'How the PBOS Ads Studio keeps drafts inside platform limits and flags invented numbers, guarantees, health claims and fake social proof.',
    date: '2026-10-22',
    tags: ['ads', 'safety'],
    blocks: [
      { type: 'p', text: 'The Ads Studio drafts copy for Meta feed, Meta Reels and YouTube video ads. It never submits anything to an ads platform and never spends money: the output is a draft you copy into the platform yourself.' },
      { type: 'h2', text: 'Limits first' },
      { type: 'p', text: 'Each format has its own length limits for the main text, headline and description. Drafts are held to them, so nothing is silently cut off when you paste it in.' },
      { type: 'h2', text: 'A scan for risky claims' },
      { type: 'p', text: 'Before you see a variant, PBOS scans it and flags or rejects copy that:' },
      { type: 'ul', items: [
        'states a number that is not in your offer, such as a discount, a price or an audience size you never gave it;',
        'guarantees a result;',
        'makes a health claim;',
        'invents social proof like “thousands of happy customers”;',
        'refers to the viewer’s personal attributes in a way ad platforms disallow;',
        'creates urgency (“last chance”, “only 3 left”) when your offer does not actually have a deadline or limit.',
      ] },
      { type: 'note', title: 'Not a clearance', text: 'Passing the scan does not mean an ad will be approved. Platform policies change and vary by country and category. Check each platform’s current rules before you publish.' },
      { type: 'link', href: '/demo', label: 'See the Ads Studio in the demo' },
    ],
  },
  {
    slug: 'try-pbos-in-ten-minutes',
    title: 'Try PBOS in ten minutes, without signing up',
    description: 'The demo is a sample workspace with a real countdown. When ten minutes are over it locks, on the server, not just on the screen.',
    date: '2026-10-23',
    tags: ['demo', 'product'],
    blocks: [
      { type: 'p', text: 'The demo opens a sample workspace filled with clearly labelled example ideas, posts, deals and invoices. You can run the daily loop, read the recommendations and see how drafts look. There is no account and nothing you do is saved to a real profile.' },
      { type: 'h2', text: 'How the ten minutes work' },
      { type: 'ul', items: [
        'The clock starts when you open the workspace. A timer on screen shows what is left.',
        'The end is enforced on the server. Reloading, going back or editing the page does not extend it.',
        'When time is up the demo locks and sends you to a page about signing up.',
        'Each browser gets one demo every 24 hours, and a small number of demos can start from one network per hour.',
      ] },
      { type: 'note', title: 'Sample data', text: 'Everything in the demo is invented example data. The numbers are not real results from any creator and are not a prediction of what you would see.' },
      { type: 'link', href: '/demo', label: 'Start the demo' },
    ],
  },
];

/** Newest first; ties keep the order they were written in. */
export function sortedPosts(posts: readonly Post[] = POSTS): Post[] {
  return posts
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (a.p.date === b.p.date ? a.i - b.i : a.p.date < b.p.date ? 1 : -1))
    .map((x) => x.p);
}

export function findPost(slug: string): Post | undefined {
  return POSTS.find((p) => p.slug === slug);
}

/** Previous (older) and next (newer) post for navigation at the end of an article. */
export function neighbours(slug: string): { newer: Post | null; older: Post | null } {
  const list = sortedPosts();
  const i = list.findIndex((p) => p.slug === slug);
  if (i < 0) return { newer: null, older: null };
  return { newer: list[i - 1] ?? null, older: list[i + 1] ?? null };
}

export function postText(post: Post): string {
  return post.blocks
    .map((b) => {
      if (b.type === 'ul') return b.items.join(' ');
      if (b.type === 'note') return `${b.title} ${b.text}`;
      if (b.type === 'link') return b.label;
      return b.text;
    })
    .join(' ');
}

/** About 200 words a minute, never less than one minute. */
export function readingMinutes(post: Post): number {
  const words = postText(post).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

export function formatPostDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** RSS 2.0 feed. `base` is the site URL without a trailing slash. */
export function rssXml(base: string, posts: readonly Post[] = POSTS): string {
  const items = sortedPosts(posts)
    .map((p) => {
      const url = `${base}/blog/${p.slug}`;
      return `    <item>
      <title>${escapeXml(p.title)}</title>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="true">${escapeXml(url)}</guid>
      <pubDate>${new Date(`${p.date}T12:00:00Z`).toUTCString()}</pubDate>
      <description>${escapeXml(p.description)}</description>
    </item>`;
    })
    .join('\n');
  const newest = sortedPosts(posts)[0];
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>PBOS blog</title>
    <link>${escapeXml(`${base}/blog`)}</link>
    <description>How PBOS works, what it asks for and what it will not do.</description>
    <language>en</language>
    <atom:link href="${escapeXml(`${base}/blog/rss.xml`)}" rel="self" type="application/rss+xml" />
${newest ? `    <lastBuildDate>${new Date(`${newest.date}T12:00:00Z`).toUTCString()}</lastBuildDate>\n` : ''}${items}
  </channel>
</rss>
`;
}
