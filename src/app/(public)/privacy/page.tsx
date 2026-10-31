import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/legal';
import { PublicShell } from '@/components/public-shell';
import { companyAddress, companyName } from '@/lib/company';
import { contactEmail } from '@/lib/env';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description: 'What PBOS stores, what it receives from Google and Meta, who processes it, how long it is kept, and how to download or delete everything.',
  alternates: { canonical: '/privacy' },
};

const EXT = { target: '_blank', rel: 'noopener noreferrer' } as const;

export default function PrivacyPage() {
  const email = contactEmail();
  return (
    <PublicShell>
      <LegalPage title="Privacy policy">
        <section>
          <h2>Who we are</h2>
          <p>
            PBOS (Personal Brand Operating System) is operated by {companyName()}, {companyAddress()} (“we”). We decide why and how the personal data described here is used, so we are the
            controller of it. You can reach us at {email ?? '[Contact email]'}.
          </p>
        </section>

        <section>
          <h2>What we collect</h2>
          <ul>
            <li>
              <strong>Account.</strong> Your email address, name and a profile picture if you sign in with Google. Passwords are handled by our sign-in provider and are never visible to us.
            </li>
            <li>
              <strong>What you enter.</strong> Your profile (niche, positioning, voice, goals, audience notes, collaboration options, rate card, FAQ, an optional AI persona and photo), and your ideas, posts and
              metrics, deals, contacts attached to deals, and invoices.
            </li>
            <li>
              <strong>Files and prompts.</strong> Videos and images you upload, images you generate and the prompts you used, and ad copy drafts. The video Studio edits inside your browser: the footage you load, or a library video fetched to your device through a short-lived link, is not sent to us while you edit. A finished video is uploaded only when you choose “Save to my library”.
            </li>
            <li>
              <strong>Connected accounts, only if you connect them.</strong> See the two sections below.
            </li>
            <li>
              <strong>Your activity in PBOS.</strong> The assistant’s flags, suggestions and drafts, whether you accepted or ignored them, publish jobs and their status, and daily usage counters we use to apply limits.
            </li>
            <li>
              <strong>Messages sent through a public media kit.</strong> The sender’s name, email address, company and message. This is data about the sender, held for the creator who owns that page.
            </li>
            <li>
              <strong>Technical data.</strong> Our hosting provider and security layer process IP addresses and request details to deliver the site and block abuse. Our own rate limits use your IP address in memory only and do
              not store it in the database.
            </li>
          </ul>
        </section>

        <section id="google">
          <h2>Data from Google and YouTube</h2>
          <p>If you connect YouTube, you grant PBOS these permissions. You see them on Google’s consent screen before you agree.</p>
          <ul>
            <li>Upload videos to your channel (<code>youtube.upload</code>). Used only to upload a video you have approved.</li>
            <li>View your YouTube account (<code>youtube.readonly</code>). Used to show your channel name and the details of your videos.</li>
            <li>View YouTube Analytics reports (<code>yt-analytics.readonly</code>). Used to show you your views, watch time and subscriber figures.</li>
          </ul>
          <p>
            We store your channel identifier, title and the video details and report figures we retrieve, and an encrypted access token and refresh token. We use this data only to provide and improve the features you
            see in PBOS: publishing what you approve, showing your numbers, and giving you recommendations based on them. We do not sell it, do not use it for advertising, and do not use it to train generalized
            artificial intelligence or machine-learning models. We do not allow people to read it, except with your consent for support, where necessary for security or to investigate abuse, or to comply with law.
          </p>
          <p>
            PBOS’s use and transfer to any other app of information received from Google APIs will adhere to the{' '}
            <a href="https://developers.google.com/terms/api-services-user-data-policy" {...EXT}>
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </p>
          <p>
            By using PBOS’s YouTube features you also agree to be bound by the{' '}
            <a href="https://www.youtube.com/t/terms" {...EXT}>
              YouTube Terms of Service
            </a>
            , and Google’s{' '}
            <a href="https://policies.google.com/privacy" {...EXT}>
              Privacy Policy
            </a>{' '}
            applies to how Google handles your data. You can revoke PBOS’s access at any time in your Google account’s{' '}
            <a href="https://security.google.com/settings/security/permissions" {...EXT}>
              security settings
            </a>
            , or by disconnecting on our Connections page.
          </p>
        </section>

        <section id="meta">
          <h2>Data from Instagram and Meta</h2>
          <p>
            If you connect Instagram, you grant PBOS permission to find your professional Instagram account through the Facebook Page it is linked to, publish content you have approved, and read your account and
            media insights. The permissions are <code>instagram_basic</code>, <code>instagram_content_publish</code>, <code>instagram_manage_insights</code>, <code>pages_show_list</code> and{' '}
            <code>pages_read_engagement</code>.
          </p>
          <p>
            We store the account identifier, username, the insight figures and media details we retrieve, and encrypted tokens. We use them only to provide the features above, we do not sell them or use them for
            advertising, and we do not share them with third parties other than the processors listed below. You can remove PBOS in your Instagram or Facebook app settings, or disconnect on our Connections page. Meta
            can ask us to delete the data tied to your Instagram connection; we do this automatically (see{' '}
            <Link href="/data-deletion">data deletion</Link>).
          </p>
        </section>

        <section>
          <h2>How AI is used</h2>
          <p>
            When you run the daily review, ask the agent to do something, or request a draft, we send the fields needed for that task to Anthropic’s API: your request, parts of your profile, and the specific records involved, such as
            an idea’s hook, a deal’s brand, stage and deliverables, an invoice’s amount and due date, your post and platform figures, or the name, company and message of a contact-form inquiry. The agent reads your records one step at a time, and what each step returns is sent along so it can continue. Contact email addresses are not included. When you generate an image, your prompt
            is sent to OpenAI’s Images API. We send the minimum needed for the task, and these providers act on our instructions. Drafts are never sent or published without your approval, and generated images are marked as AI-generated in your library.
          </p>
        </section>

        <section>
          <h2>Why we use your data (legal bases)</h2>
          <ul>
            <li>To provide the service you asked for, including connecting accounts and publishing what you approve (performance of a contract).</li>
            <li>To keep the service secure, prevent abuse and apply usage limits (our legitimate interests).</li>
            <li>To run optional analytics on public pages, and to connect your accounts at Google and Meta (your consent, which you can withdraw).</li>
            <li>To meet legal obligations.</li>
          </ul>
        </section>

        <section>
          <h2>Who else processes data</h2>
          <ul>
            <li>Clerk: sign-in, including Google sign-in, and sessions.</li>
            <li>Supabase: database and file storage. Our project is hosted in the EU (Ireland).</li>
            <li>Vercel: hosts the site and keeps technical logs.</li>
            <li>Cloudflare: security services such as Turnstile spam checks on the contact form and the demo.</li>
            <li>Anthropic: AI requests for drafts, findings and answers.</li>
            <li>OpenAI: image generation.</li>
            <li>Google (YouTube) and Meta (Instagram): the platforms you choose to connect, receiving what you publish.</li>
            <li>Plausible: optional visit counts on public pages, only if enabled and only after you accept.</li>
          </ul>
          <p>
            We do not sell personal data. Some of these providers are outside your country, including in the United States. Where the law requires it, transfers rely on safeguards such as standard contractual clauses
            [operator to confirm the transfer mechanism for each provider].
          </p>
        </section>

        <section>
          <h2>Cookies and local storage</h2>
          <p>
            We use the cookies needed to sign you in, to run the demo, and to connect your accounts safely. Analytics load only on public pages and only after you accept. The full list is on the{' '}
            <Link href="/cookies">cookies page</Link>.
          </p>
        </section>

        <section>
          <h2>How long we keep data</h2>
          <ul>
            <li>Your data stays until you delete it or delete your account.</li>
            <li>Disconnecting a platform deletes its stored tokens straight away. You can choose to delete the numbers and posts synced from it too.</li>
            <li>Deleting your account removes your profile, records, files, connection details and sign-in account. Backups held by our database provider expire on its schedule [operator to state the backup period].</li>
            <li>Contact-form messages stay until the creator who owns the page deletes them or deletes their account.</li>
            <li>Demo sessions hold no personal data; the demo cookie holds a signed timer.</li>
          </ul>
        </section>

        <section>
          <h2>Your choices and rights</h2>
          <p>
            In Settings you can <strong>download all your data</strong> as a JSON file and <strong>delete your account</strong> with its data, and on the Connections page you can disconnect YouTube or Instagram and
            delete what was synced from them. You can also ask us to access, correct, restrict or delete data, to object to processing, or to move it elsewhere, and to complain to your data protection authority. Write to{' '}
            {email ?? '[Contact email]'}. We answer within one month.
          </p>
        </section>

        <section>
          <h2>Security</h2>
          <p>
            Each creator’s data is isolated by row-level security in the database. Connection tokens are encrypted before storage and are never sent to your browser. Service keys and AI keys stay on the server. Read
            more on the <Link href="/security">security page</Link>. No system is perfectly secure; if a breach affects you we will tell you and the authorities where the law requires.
          </p>
        </section>

        <section>
          <h2>Children</h2>
          <p>PBOS is not directed at children under 16, and we do not knowingly collect their data. If you think a child has given us data, contact us and we will delete it.</p>
        </section>

        <section>
          <h2>Changes</h2>
          <p>If this policy changes in a way that matters, we will tell signed-in creators and update the date at the top.</p>
        </section>
      </LegalPage>
    </PublicShell>
  );
}
