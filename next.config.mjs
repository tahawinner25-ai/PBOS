import { securityHeaders } from './src/lib/security-headers.mjs';

// Allow next/image to serve creator avatars from Supabase Storage (public bucket).
function supabaseImagePatterns() {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return [];
  try {
    const u = new URL(raw);
    return [
      {
        protocol: u.protocol.replace(':', ''),
        hostname: u.hostname,
        ...(u.port ? { port: u.port } : {}),
        pathname: '/storage/v1/object/public/**',
      },
    ];
  } catch {
    return [];
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    remotePatterns: supabaseImagePatterns(),
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders({
          production: process.env.NODE_ENV === 'production',
          // Escape hatch: CSP_REPORT_ONLY=true logs violations in the browser console without blocking anything.
          reportOnly: process.env.CSP_REPORT_ONLY === 'true',
          clerkPublishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
          plausibleDomain: process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN,
        }),
      },
    ];
  },
};

export default nextConfig;
