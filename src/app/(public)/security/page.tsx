import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal';
import { PublicShell } from '@/components/public-shell';
import { contactEmail } from '@/lib/env';

export const metadata: Metadata = {
  title: 'Security',
  description: 'How PBOS protects your account, your connected YouTube and Instagram access, and your data, and how to report a vulnerability.',
  alternates: { canonical: '/security' },
};

export default function SecurityPage() {
  const email = contactEmail();
  return (
    <PublicShell>
      <LegalPage title="Security">
        <section>
          <h2>What we do</h2>
          <ul>
            <li>
              <strong>Isolation.</strong> Every table that holds your data has row-level security, so the database itself refuses to return another creator’s rows. Server code that needs elevated access is scoped by
              your creator id.
            </li>
            <li>
              <strong>Connection tokens.</strong> YouTube and Instagram tokens are encrypted with AES-256-GCM before they are stored, support key rotation, and are never sent to your browser. Your signed-in database role
              cannot select the token columns at all.
            </li>
            <li>
              <strong>Safe sign-in to Google and Meta.</strong> The connect flow uses a signed, short-lived state value and PKCE, and the callback must match the account that started it.
            </li>
            <li>
              <strong>Your approval comes first.</strong> A post cannot leave draft without your approval, enforced in the database as well as in the application.
            </li>
            <li>
              <strong>Uploads.</strong> Files go to a private bucket through short-lived signed URLs, are limited by size, and are identified by their actual bytes rather than their names.
            </li>
            <li>
              <strong>Input and limits.</strong> Inputs are validated on the server, API routes are rate limited, and responses return only the fields a page needs.
            </li>
            <li>
              <strong>Web protections.</strong> A strict content security policy, HSTS and other security headers, and Cloudflare Turnstile spam checks on public forms.
            </li>
            <li>
              <strong>Logs.</strong> We do not write tokens, passwords or message contents to logs.
            </li>
          </ul>
        </section>

        <section>
          <h2>Your part</h2>
          <ul>
            <li>Use a strong, unique password or sign in with Google with two-step verification turned on.</li>
            <li>Disconnect platforms you no longer use, from the Connections page.</li>
            <li>Check the preview on a draft before you approve it.</li>
          </ul>
        </section>

        <section>
          <h2>Report a vulnerability</h2>
          <p>
            If you find a security problem, please tell us privately at {email ?? '[Contact email]'} before publishing details. Include what you found and how to reproduce it. We will acknowledge your report, keep you
            informed, and will not take action against good-faith research that avoids other people’s data and stays within these limits: no denial of service, no social engineering, and no access to data that is not
            yours. Our machine-readable contact is at <a href="/.well-known/security.txt">/.well-known/security.txt</a>.
          </p>
        </section>

        <section>
          <h2>What this page is not</h2>
          <p>
            It is a description of the controls in the product today, not a certification. We have not been audited by an independent third party [operator to update if that changes].
          </p>
        </section>
      </LegalPage>
    </PublicShell>
  );
}
