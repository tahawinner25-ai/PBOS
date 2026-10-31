import type { Metadata } from 'next';
import { CookieSettingsButton } from '@/components/consent-analytics';
import { LegalPage } from '@/components/legal';
import { PublicShell } from '@/components/public-shell';

export const metadata: Metadata = {
  title: 'Cookies',
  description: 'Every cookie and local-storage item PBOS uses, what it is for and how long it lasts.',
  alternates: { canonical: '/cookies' },
};

type Row = { name: string; by: string; purpose: string; lasts: string };

const NECESSARY: Row[] = [
  { name: '__session, __client_uat and related Clerk cookies', by: 'Clerk (our sign-in provider)', purpose: 'Keep you signed in and protect sign-in against forgery. Exact names are set by Clerk and can change.', lasts: 'Session, up to the session lifetime you choose in your account' },
  { name: 'pbos_oauth', by: 'PBOS', purpose: 'Holds a signed, one-time value while you connect YouTube or Instagram, so a forged return from Google or Meta is rejected.', lasts: '10 minutes' },
  { name: 'pbos_demo', by: 'PBOS', purpose: 'Holds the signed start time of your 10-minute demo, so the server can lock it when the time is up.', lasts: 'Up to 24 hours (the demo itself is 10 minutes)' },
  { name: 'pbos_demo_used', by: 'PBOS', purpose: 'Remembers that this browser has already used the demo, so it is offered once per day.', lasts: '24 hours' },
];

const STORAGE: Row[] = [
  { name: 'pbos-consent (local storage)', by: 'PBOS', purpose: 'Remembers whether you accepted or declined analytics so the banner does not return.', lasts: 'Until you clear site data' },
  { name: 'Theme and display choices (local storage)', by: 'PBOS', purpose: 'Remembers display preferences you set, such as text size or reduced motion.', lasts: 'Until you clear site data' },
];

function Table({ rows, label }: { rows: Row[]; label: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="text-sm">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr className="border-b border-border">
            <th scope="col">Name</th>
            <th scope="col">Set by</th>
            <th scope="col">What it does</th>
            <th scope="col">How long</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.name}>
              <th scope="row" className="font-medium">
                <code>{r.name}</code>
              </th>
              <td>{r.by}</td>
              <td className="text-muted-foreground">{r.purpose}</td>
              <td className="text-muted-foreground">{r.lasts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function CookiesPage() {
  return (
    <PublicShell>
      <LegalPage title="Cookies and local storage">
        <section>
          <h2>The short version</h2>
          <p>
            PBOS uses the cookies it needs to sign you in, run the demo and connect your accounts safely. It does not use advertising cookies. Visit counts on public pages are optional and load only after you accept.
          </p>
          <p>
            <CookieSettingsButton className="underline underline-offset-4" />
          </p>
        </section>

        <section>
          <h2>Cookies that are strictly necessary</h2>
          <p>These work without consent because the service cannot work without them.</p>
          <Table rows={NECESSARY} label="Strictly necessary cookies" />
        </section>

        <section>
          <h2>Local storage on your device</h2>
          <Table rows={STORAGE} label="Local storage items" />
        </section>

        <section>
          <h2>Optional analytics</h2>
          <p>
            If the site operator has turned on Plausible, a small script counts visits to public pages after you accept. It is never loaded inside the signed-in workspace or the demo. Choose “Cookie settings” in the footer to
            change your choice at any time.
          </p>
        </section>

        <section>
          <h2>Third-party services</h2>
          <p>
            Cloudflare Turnstile may run a short check on the contact form and when starting the demo. Google and Meta set their own cookies on their own sign-in pages when you connect an account; those are governed by their
            policies.
          </p>
        </section>
      </LegalPage>
    </PublicShell>
  );
}
