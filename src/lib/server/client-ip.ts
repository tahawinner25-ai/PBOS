type HeaderReader = { get(name: string): string | null };

/**
 * The visitor's IP address, used only to rate-limit the public contact form.
 *
 * `cf-connecting-ip` is trusted only when TRUST_CLOUDFLARE=true, i.e. when every request really arrives
 * through Cloudflare's proxy. Otherwise anyone could send that header themselves and dodge the limit.
 */
export function resolveClientIp(headers: HeaderReader, trustCloudflare: boolean): string {
  if (trustCloudflare) {
    const cf = headers.get('cf-connecting-ip')?.trim();
    if (cf) return cf;
  }
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim() || 'unknown';
  return headers.get('x-real-ip')?.trim() || 'unknown';
}
