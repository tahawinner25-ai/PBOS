import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/legal';
import { PublicShell } from '@/components/public-shell';
import { companyName, governingLaw } from '@/lib/company';

export const metadata: Metadata = {
  title: 'Terms of use',
  description: 'The terms for using PBOS: what it does, what it does not do, how connected accounts work and what you remain responsible for.',
  alternates: { canonical: '/terms' },
};

const EXT = { target: '_blank', rel: 'noopener noreferrer' } as const;

export default function TermsPage() {
  return (
    <PublicShell>
      <LegalPage title="Terms of use">
        <section>
          <h2>Who these terms are between</h2>
          <p>
            These terms are between you and {companyName()} (“we”), who operate PBOS. By creating an account or using the service you agree to them. If you do not agree, do not use PBOS. You must be at least 16 and
            able to enter a binding agreement, or have a parent or guardian do so for you.
          </p>
        </section>

        <section>
          <h2>What PBOS is</h2>
          <p>
            PBOS is a workspace for creators to organise ideas, posts, deals and invoices, to connect YouTube and Instagram, to prepare and approve posts, to generate images and ad drafts, and to get
            recommendations and drafts from an AI agent based on what they enter or connect. It is provided as is and as available, without a guarantee that it will be uninterrupted, error-free or suitable for a particular purpose.
          </p>
        </section>

        <section>
          <h2>You stay in control</h2>
          <ul>
            <li>Nothing is published to YouTube or Instagram until you approve that specific post. The AI agent can prepare drafts but cannot approve them.</li>
            <li>PBOS does not send email, issue invoices, collect payment, or submit or pay for ads. You do each of those yourself.</li>
            <li>AI output can be wrong, generic or unsuitable. Read and edit every draft, image and ad before you use it.</li>
            <li>You are responsible for what you publish and send, and for following each platform’s rules and the laws that apply to you, including advertising and sponsorship disclosure rules.</li>
          </ul>
        </section>

        <section>
          <h2>Connected accounts</h2>
          <p>
            You may connect only accounts you own or are authorised to manage. By connecting YouTube you agree to be bound by the{' '}
            <a href="https://www.youtube.com/t/terms" {...EXT}>
              YouTube Terms of Service
            </a>
            ; by connecting Instagram you remain bound by Meta’s terms and Instagram’s community rules. You can disconnect at any time. Platforms may limit, suspend or change their interfaces, quotas and
            review requirements, and publishing or analytics may stop working when they do. We are not responsible for a platform’s decisions about your account or content.
          </p>
        </section>

        <section>
          <h2>No promises about results</h2>
          <p>
            Nothing in PBOS promises or predicts income, audience growth, reach, brand deals or any other outcome. Forecasts such as the weighted pipeline are estimates built from fixed assumptions and the values you
            enter. They are not guaranteed income.
          </p>
        </section>

        <section>
          <h2>Your content and your numbers</h2>
          <p>
            You keep ownership of what you upload, enter or generate. You give us permission to store, process and transmit it, including to the platforms you choose and to the processors listed in the{' '}
            <Link href="/privacy">privacy policy</Link>, only as needed to run PBOS for you. You promise you have the rights to your content, and that you are responsible for the accuracy of what you enter. PBOS does not verify
            metrics, invoices or deal values; if you publish figures on a media kit, make sure they are true and not misleading.
          </p>
        </section>

        <section>
          <h2>AI personas, generated images and real people</h2>
          <p>
            An AI persona on a public page is always labelled as AI-generated, and the label cannot be removed. Images created in PBOS are marked as AI-generated in your library; follow each platform’s rules for
            labelling AI-generated content when you publish them. Do not use PBOS to imitate a real person without their consent or to deceive anyone about who they are dealing with.
          </p>
        </section>

        <section>
          <h2>Acceptable use</h2>
          <p>
            Do not use PBOS to break the law; to harass, defraud or mislead anyone; to publish spam, malware or content that infringes someone’s rights; to generate ads with false or unprovable claims; to bypass limits, the
            demo’s time limit or the security of the service; or to access data that is not yours. We may limit or suspend an account that does.
          </p>
        </section>

        <section>
          <h2>Contracts with brands</h2>
          <p>
            Prices and options on a media kit are a starting point for a conversation, not a binding offer. Any agreement with a brand is made between you and that brand, in writing, and PBOS is not a party to it.
            Drafts produced by PBOS are not legal advice and do not contain binding legal terms.
          </p>
        </section>

        <section>
          <h2>Price</h2>
          <p>PBOS is currently free to use [operator to state any plan, price or trial before charging for anything]. We will tell you before that changes, and nothing is charged without your agreement.</p>
        </section>

        <section>
          <h2>Ending use</h2>
          <p>
            You can stop using PBOS and delete your account and data at any time in Settings. We may suspend or end an account that breaks these terms, and we may change or end the service, giving notice where we reasonably can.
          </p>
        </section>

        <section>
          <h2>Liability</h2>
          <p>
            To the extent the law allows, we are not liable for indirect or consequential loss, lost income, lost followers or lost opportunities arising from using PBOS, and our total liability is limited to
            [operator to state amount]. Nothing here limits liability that cannot be limited by law, including for death or personal injury caused by negligence or for fraud.
          </p>
        </section>

        <section>
          <h2>Changes and governing law</h2>
          <p>
            We may update these terms; the date at the top shows the latest version, and we will tell signed-in creators about changes that matter. Governing law and venue: {governingLaw()}.
          </p>
        </section>
      </LegalPage>
    </PublicShell>
  );
}
