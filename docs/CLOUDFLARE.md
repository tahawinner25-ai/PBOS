# Cloudflare

What is already in the code, what you switch on in Cloudflare, and the one decision (proxy or not) to make with open eyes.

## Already in the code

| Piece | Where | Needs |
|---|---|---|
| **Turnstile** spam check on the media-kit contact form and on starting the 10-minute demo | `src/components/turnstile.tsx`, `src/app/api/contact/route.ts`, `src/app/api/demo/start/route.ts` | `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` |
| **CSP and headers** that allow `challenges.cloudflare.com` (script, frame, connect) and nothing else third-party beyond Clerk, Supabase and optional Plausible | `src/lib/security-headers.mjs` | none |
| **Client IP** for rate limits. `cf-connecting-ip` is trusted only when `TRUST_CLOUDFLARE=true` | `src/lib/server/client-ip.ts` | `TRUST_CLOUDFLARE` (see below) |

Set **both** keys or **neither**. With neither, the forms work and the server skips the check. With both, a missing or failing token is rejected. With only one, the forms refuse to submit (a half-configured check fails closed) and the server logs why.

## 1. Turnstile (do this one; it is free and has no downsides)

1. Cloudflare dashboard → **Turnstile** → **Add widget**.
2. Name it `PBOS`, add your domain (and `localhost` for development), mode **Managed**.
3. Copy the **Site key** to `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and the **Secret key** to `TURNSTILE_SECRET_KEY` in Vercel (Production and Preview). Redeploy.
4. Check: open `/work-with-me` (once a media kit is published) and `/demo`. The widget appears; a request without a token is rejected by the API.

## 2. Cloudflare as DNS (recommended default)

Move the domain's nameservers to Cloudflare, then add the records Vercel shows for the domain with the cloud set to **DNS only** (grey). You get Cloudflare's DNS, registrar pricing and dashboard, and traffic still goes straight to Vercel.

## 3. Cloudflare as a proxy in front of Vercel (optional, with trade-offs)

Vercel's own guidance is that putting another proxy in front of it is **not recommended** and is meant for organisations that must. Read [Vercel: Cloudflare with Vercel](https://vercel.com/kb/guide/cloudflare-with-vercel) first. The points that matter for PBOS:

- Set SSL/TLS to **Full (strict)**. **Flexible** causes redirect loops.
- Exempt `/.well-known/acme-challenge/*` from HTTPS redirects, WAF and bot challenges, and never cache `/.well-known/vercel/*`.
- Vercel's bot protection and DDoS signals see Cloudflare's IPs, not your visitors'.
- Do not cache HTML at Cloudflare at first. A stale page can point at assets from an older deployment.
- **Client IPs and `TRUST_CLOUDFLARE`.** With the proxy on, Vercel's `x-forwarded-for` carries Cloudflare's address, so every rate limit would key on a Cloudflare edge IP. Setting `TRUST_CLOUDFLARE=true` makes PBOS read `cf-connecting-ip` instead, but **only set it if nobody can reach the site without going through Cloudflare**. Your `*.vercel.app` URL is public, and a visitor on it can send a fake `cf-connecting-ip` and dodge the limits. Either keep the flag `false` (limits are then coarse but cannot be forged) or block direct access first.

If you still want the proxy, these rules suit PBOS:

1. **WAF → Managed rules**: turn on the Cloudflare managed ruleset.
2. **Rate limiting rule**: path starts with `/api/` → 100 requests per minute per IP, then block for a minute. Exclude `/api/webhooks/` and `/api/cron/` (Meta and your scheduler call these from fixed addresses).
3. **Bot Fight Mode**: leave off if it challenges your own cron or Meta's webhook callers; test first.
4. **Do not challenge** `/api/webhooks/*` (Meta signs those requests itself) or `/api/cron/*` (protected by `CRON_SECRET`).

## Not done by this repository

DNS, nameservers, WAF and rate-limit rules live in your Cloudflare account and cannot be created from the code. Nothing here has been run against a live Cloudflare zone.
