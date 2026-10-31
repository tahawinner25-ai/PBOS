import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal';
import { PublicShell } from '@/components/public-shell';

export const metadata: Metadata = {
  title: 'Accessibility',
  description: 'How PBOS aims to be usable by everyone, the display choices you can make, what has been checked, and the gaps we know about.',
  alternates: { canonical: '/accessibility' },
};

export default function AccessibilityPage() {
  return (
    <PublicShell>
      <LegalPage title="Accessibility">
        <section>
          <h2>Our aim</h2>
          <p>
            PBOS should be usable by people who use a keyboard, a screen reader, magnification, voice control or a small screen, and by people who find busy or low-contrast pages tiring. The standard we are working to is
            WCAG 2.2 level AA. This page is a self-assessment: PBOS has not yet been audited by an independent accessibility specialist, so we do not claim full conformance.
          </p>
        </section>

        <section>
          <h2>Display settings you can change</h2>
          <p>
            Choose “Display settings” in the footer of public pages or in the sidebar of the app. Your choices apply immediately and are remembered in this browser only. They are not sent to us.
          </p>
          <ul>
            <li><strong>Text size:</strong> standard, large, larger or largest. It scales on top of your browser’s own text-size setting.</li>
            <li><strong>Contrast:</strong> a high-contrast mode with black and white surfaces and stronger borders.</li>
            <li><strong>Typeface:</strong> a plain, wide system font with more space between letters, words and lines.</li>
            <li><strong>Motion:</strong> reduce animation and transitions. PBOS also follows your device’s “reduce motion” setting without you asking.</li>
          </ul>
        </section>

        <section>
          <h2>What is built in</h2>
          <ul>
            <li>Every page works with a keyboard alone, and keyboard focus is always visible. A “Skip to main content” link is the first thing in the tab order.</li>
            <li>Form fields have visible labels. Errors are announced to screen readers, and success messages appear as short notices rather than pop-ups that steal focus.</li>
            <li>Pages are built from headings, lists, labelled navigation and a main region, and icons are hidden from screen readers where text already says the same thing.</li>
            <li>Text and controls are checked against contrast minimums: 4.5 to 1 for text and 3 to 1 for form-field borders and focus rings, in both the dark app theme and the light public theme. The check runs in our test suite against the real stylesheet.</li>
            <li>Nothing flashes. The only animations are a loading spinner and a soft placeholder pulse, and both stop when you reduce motion.</li>
            <li>Nothing is published, sent or paid for without your approval, so a mistaken keystroke or click on its own does not send anything out.</li>
          </ul>
        </section>

        <section>
          <h2>The video Studio</h2>
          <ul>
            <li>Every Studio control, including trimming, splitting, reordering, text and export, is a native form control you can use with a keyboard and a screen reader. Trim points can be typed as numbers, not only dragged.</li>
            <li>The preview picture is described in words (the clip, the time and any text on screen) for screen readers. Video editing is a visual task, so choosing what is on screen still depends on being able to see it or on someone who can.</li>
            <li>The Studio does not generate captions or audio descriptions. If you publish a video, adding captions is up to you, and YouTube and Instagram each have their own tools for it.</li>
          </ul>
        </section>

        <section>
          <h2>Known gaps</h2>
          <ul>
            <li><strong>No independent audit.</strong> We have run automated and scripted checks in a real browser, but we have not yet tested with a range of screen readers or with disabled users, so there will be problems we have not found.</li>
            <li><strong>The public demo has a time limit.</strong> It locks after ten minutes and says so before it does, with a reminder at two minutes and at one minute. It contains sample data only, and you can start it again. The limit exists to protect the service, and we cannot offer a way to extend it.</li>
            <li><strong>Sign-in is provided by Clerk, and the contact form uses Cloudflare Turnstile.</strong> Their widgets are built by those companies and we cannot fix them ourselves. If one stops you, use the contact address below.</li>
            <li><strong>Posts you draft are only as accessible as you make them.</strong> PBOS does not write image descriptions (alt text) for you. AI-generated images are labelled as such.</li>
          </ul>
        </section>

        <section>
          <h2>Tell us about a problem</h2>
          <p>
            If something here does not work for you, tell us what you were trying to do, the page, and the device and assistive technology you use. We will treat it as a bug. If a barrier stops you from using
            PBOS at all, say so and we will find another way to help.
          </p>
        </section>
      </LegalPage>
    </PublicShell>
  );
}
