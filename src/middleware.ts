import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { decideDemoAccess, DEMO_COOKIE } from '@/lib/demo-session';

/** Pages that need a signed-in creator. API routes answer 401 themselves, so they are not redirected here. */
const isPrivatePage = createRouteMatcher(['/dashboard(.*)', '/ideas(.*)', '/analytics(.*)', '/deals(.*)', '/revenue(.*)', '/settings(.*)', '/onboarding(.*)', '/preview(.*)', '/publish(.*)', '/agent(.*)', '/library(.*)', '/ads(.*)', '/studio(.*)', '/connections(.*)']);
const isAuthPage = createRouteMatcher(['/login(.*)', '/signup(.*)']);

const withClerk = clerkMiddleware(
  async (auth, request) => {
    const { userId, redirectToSignIn } = await auth();
    if (!userId && isPrivatePage(request)) return redirectToSignIn({ returnBackUrl: request.url });
    if (userId && isAuthPage(request)) return NextResponse.redirect(new URL('/dashboard', request.url));
    return NextResponse.next();
  },
  { signInUrl: '/login', signUpUrl: '/signup' },
);

export default async function middleware(request: NextRequest, event: NextFetchEvent) {
  // The 10-minute demo is checked first and does not depend on Clerk. The same decision function runs again in each demo page and API.
  const { pathname } = request.nextUrl;
  if (pathname.startsWith('/demo') || pathname.startsWith('/api/demo')) {
    const access = await decideDemoAccess({ pathname, cookie: request.cookies.get(DEMO_COOKIE)?.value, now: Date.now(), secret: process.env.DEMO_SESSION_SECRET });
    if (access.action === 'redirect') return NextResponse.redirect(new URL(access.to, request.url));
    if (access.action === 'api') return NextResponse.json({ error: access.error }, { status: access.status, headers: { 'Cache-Control': 'no-store' } });
    return NextResponse.next();
  }

  // Without Clerk keys the private pages render a setup notice and the public pages work normally,
  // so a fresh deployment does not fail on every request.
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) return NextResponse.next();
  return withClerk(request, event);
}

export const config = {
  // Public pages (/, /work-with-me, /privacy, /terms) never run through Clerk, so they stay fast and cacheable.
  matcher: [
    '/(dashboard|ideas|analytics|deals|revenue|settings|onboarding|preview|publish|agent|library|ads|studio|connections|login|signup)(.*)',
    '/demo(.*)',
    '/api/(.*)',
  ],
};
