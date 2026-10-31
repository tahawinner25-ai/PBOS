import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans, Newsreader } from 'next/font/google';
import { ConsentAndAnalytics } from '@/components/consent-analytics';
import { ToastProvider } from '@/components/toast';
import { DISPLAY_INIT_SCRIPT } from '@/lib/display-prefs';
import { siteUrl } from '@/lib/env';
import './globals.css';

const sans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-sans', display: 'swap' });
const serif = Newsreader({ subsets: ['latin'], style: ['normal', 'italic'], variable: '--font-serif', display: 'swap', adjustFontFallback: false });

const DESCRIPTION =
  'PBOS is an operating system for one creator: it scans your ideas, posts, deals and invoices, tells you what needs attention, and drafts the next asset for you to approve.';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: 'PBOS: Personal Brand Operating System', template: '%s · PBOS' },
  description: DESCRIPTION,
  applicationName: 'PBOS',
  openGraph: {
    type: 'website',
    siteName: 'PBOS',
    title: 'PBOS: Personal Brand Operating System',
    description: DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PBOS: Personal Brand Operating System',
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#101223',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable}`} suppressHydrationWarning>
      <head>
        {/* Applies saved display choices (text size, contrast) before first paint. Fixed content, no user input. */}
        <script dangerouslySetInnerHTML={{ __html: DISPLAY_INIT_SCRIPT }} />
      </head>
      <body>
        <a href="#main" className="skip-link">
          Skip to main content
        </a>
        <ToastProvider>{children}</ToastProvider>
        <ConsentAndAnalytics plausibleDomain={process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN || null} />
      </body>
    </html>
  );
}
