import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/legal';
import { PublicShell } from '@/components/public-shell';
import { Alert } from '@/components/ui/alert';
import { deletionStatus, parseDeletionCode, type DeletionStatus } from '@/lib/deletion-status';
import { contactEmail } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';

export const metadata: Metadata = {
  title: 'Data deletion',
  description: 'How to delete your PBOS data, including the data connected to your Instagram or YouTube account, and how to check a deletion request.',
  alternates: { canonical: '/data-deletion' },
  robots: { index: true, follow: true },
};
export const dynamic = 'force-dynamic';

async function lookup(rawCode: unknown): Promise<DeletionStatus> {
  const code = parseDeletionCode(rawCode);
  if (rawCode !== undefined && code === null) return { state: 'invalid' };
  if (code === null) return { state: 'none' };
  const admin = createAdminClient();
  if (!admin) return { state: 'unknown' };
  const { data, error } = await admin.from('integration_events').select('created_at').eq('type', 'data_deleted').filter('detail->>code', 'eq', code).limit(5);
  if (error) {
    console.error('[data-deletion] lookup failed:', error.code);
    return { state: 'unknown' };
  }
  return deletionStatus(code, data as Array<{ created_at: string }>);
}

export default async function DataDeletionPage({ searchParams }: { searchParams: { code?: string | string[] } }) {
  const email = contactEmail();
  const status = await lookup(searchParams.code);
  return (
    <PublicShell>
      <LegalPage title="Data deletion">
        {status.state !== 'none' ? (
          <section aria-live="polite">
            {status.state === 'done' ? (
              <Alert variant="success" title="Your deletion request was completed.">
                Completed on {new Date(status.at).toUTCString()}. Everything PBOS held that came from the connected Instagram account was deleted.
              </Alert>
            ) : status.state === 'invalid' ? (
              <Alert variant="warning" title="That confirmation code is not valid.">
                Codes are 16 characters made of the digits 0–9 and the letters a–f. Copy the code again from the link you were given.
              </Alert>
            ) : (
              <Alert variant="warning" title="We could not find that request.">
                Check the code, or write to {email ?? '[Contact email]'} with it and we will look into it.
              </Alert>
            )}
          </section>
        ) : null}

        <section>
          <h2>Delete everything</h2>
          <p>
            Sign in, open <strong>Settings</strong>, then <strong>Your data</strong>, and choose <strong>Delete my account and data</strong>. This deletes your profile, everything you entered, your files, your connection
            details and your sign-in account, and it asks Google and Meta to revoke PBOS’s access. Choose <strong>Download my data</strong> first if you want a copy.
          </p>
        </section>

        <section>
          <h2>Delete only what came from YouTube or Instagram</h2>
          <p>
            Open <Link href="/connections">Connections</Link>, choose <strong>Disconnect and delete data</strong> on the platform. That removes the stored tokens, the analytics numbers, the posts
            synced from the platform and the publish history for it. Your ideas, deals and invoices are not touched.
          </p>
        </section>

        <section>
          <h2>If you start from Instagram or Facebook</h2>
          <p>
            If you remove PBOS in your Instagram or Facebook app settings and choose to delete the data, Meta tells us, and we delete everything that came from that Instagram connection straight away. We give
            you a confirmation code and a link back to this page. Open the link, or add <code>?code=</code> and your code to this page’s address, to see the result.
          </p>
        </section>

        <section>
          <h2>If you cannot sign in</h2>
          <p>
            Write to {email ?? '[Contact email]'} from the address on your account and ask us to delete it. We may ask you to confirm that you own the account before we do, and we will reply within one month.
          </p>
        </section>
      </LegalPage>
    </PublicShell>
  );
}
