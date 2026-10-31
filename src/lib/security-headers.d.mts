export function clerkFrontendHost(publishableKey: string | undefined): string | null;

export type SecurityHeaderOptions = {
  production: boolean;
  /** Send the policy as Content-Security-Policy-Report-Only instead of enforcing it. */
  reportOnly?: boolean;
  clerkPublishableKey?: string;
  supabaseUrl?: string;
  plausibleDomain?: string;
};

export function buildCsp(options: Omit<SecurityHeaderOptions, 'reportOnly'>): string;
export function securityHeaders(options: SecurityHeaderOptions): { key: string; value: string }[];
