# Legal review checklist

The legal pages (`/privacy`, `/terms`, `/cookies`, `/security`, `/data-deletion`, `/accessibility`) describe what PBOS does today. They are **drafts for a qualified lawyer to review**, not legal advice. Each page shows a "Draft pending legal review" notice until you set `LEGAL_REVIEWED = true` in `src/components/legal.tsx` **and** every placeholder variable below is filled in.

## 1. Fill in (environment variables)

| Variable | Used for |
|---|---|
| `NEXT_PUBLIC_COMPANY_NAME` | Controller / contracting party named in the privacy policy and terms |
| `NEXT_PUBLIC_COMPANY_ADDRESS` | Postal address in the privacy policy |
| `NEXT_PUBLIC_GOVERNING_LAW` | Governing law and venue in the terms |
| `NEXT_PUBLIC_CONTACT_EMAIL` | Privacy requests, security reports, `/.well-known/security.txt` (returns 404 until set) |

Other bracketed text still in the pages and needing a decision: the international-transfer mechanism per provider, the backup retention period, the liability cap, and the pricing sentence in the terms.

## 2. Statements a lawyer should confirm against the real setup

- **Controller and roles.** For contact-form messages, the creator who owns the media kit is the party the sender is writing to; PBOS stores them. Decide whether PBOS is a processor or joint controller for that data.
- **Legal bases** listed in the privacy policy.
- **Minimum age 16** (privacy and terms). Adjust to your market.
- **Google "Limited Use".** The privacy policy carries the required disclosure sentence and links. Confirm the claims "no human reads Google data except…" and "not used to train generalized AI models" match your actual practice and your AI provider's current API terms (verify that the provider does not train on API inputs under the plan you use).
- **Sub-processors** (Clerk, Supabase, Vercel, Cloudflare, Anthropic, OpenAI, Google, Meta, optional Plausible) and their data-processing agreements.
- **Data residency.** The Supabase project is in eu-west-1 (Ireland). Hosting and AI providers may process data in the US.
- **Retention and backups.** Account deletion removes rows, files and the Clerk user immediately; provider backups expire on their own schedule.
- **Cookies.** The list in `/cookies` was written from the code. Re-check it against a real browser session once deployed (Clerk's cookie names can change).

## 3. What Google and Meta ask to see (when you apply for review)

| Requirement | Where it is |
|---|---|
| Public privacy policy URL on the app's domain | `/privacy` |
| Terms of service URL | `/terms` |
| Limited Use disclosure and link to the Google API Services User Data Policy | `/privacy#google` |
| YouTube Terms of Service reference in the app's terms | `/terms` (Connected accounts) |
| How users revoke access and delete data | `/privacy`, `/data-deletion`, Settings, Connections |
| Meta data-deletion callback URL | `POST /api/webhooks/meta/data-deletion` (returns the status URL and confirmation code) |
| Meta data-deletion status page | `/data-deletion?code=…` |
| Demonstration video of each permission being used | You record this; the Connections page shows consent and each feature that uses a permission |

## 4. Things that are product decisions, not legal ones

- Sign-up is open by default. Set `SINGLE_CREATOR_MODE=true` for a private instance.
- The public media kit (`/work-with-me`) shows one published creator, chosen by `PUBLIC_CREATOR_ID` or the oldest published profile.
