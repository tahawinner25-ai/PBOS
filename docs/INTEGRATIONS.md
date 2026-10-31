# YouTube and Instagram integrations

PBOS connects to a creator's own YouTube channel and Instagram professional account to **publish what the creator approved**
and to **sync their numbers**. Nothing is published without the creator approving that specific post. PBOS does not post,
comment, follow, like or message on its own.

> **Status.** The code, the database, and the unit tests with fake Google and Meta servers are in place. **No real Google or
> Meta account has been connected**, because that needs your OAuth credentials and, for public use, the platforms' review
> processes. Everything marked *verify* below is from my knowledge of those platforms' rules at the time of writing, not from
> a call made in this build. Check Google's and Meta's current documentation before relying on it.

## What a creator gets

| | YouTube | Instagram |
| --- | --- | --- |
| Publish | Videos and Shorts, uploaded in chunks straight from the browser (resumable upload), private by default, optional schedule held by YouTube | Photo, Reel and carousel posts through Meta's two-step publish (create a container, then publish it) |
| Timing | YouTube holds a scheduled video until its publish time | PBOS publishes at the chosen time, so a scheduler must call `/api/cron/publish` (see *Scheduled jobs*) |
| Sync | Channel and recent-video numbers | Account insights and recent media |
| Disconnect | Revokes the token at Google (best effort), deletes the stored tokens and synced data | Revokes at Meta (best effort), deletes the stored tokens and synced data |

Posting goes through one dashboard ("Publish"): draft → creator approves → scheduled → uploading or processing → posted. A
post whose result is unclear lands in **needs review** and is never retried automatically, so it cannot be posted twice.

## Setup order

1. Run the Supabase migrations (see the README) and set the Clerk and Supabase variables first. Connections need a signed-in
   creator.
2. `npm run gen-keys` prints fresh values for `TOKEN_ENCRYPTION_KEYS`, `OAUTH_STATE_SECRET`, `CRON_SECRET` and
   `META_WEBHOOK_VERIFY_TOKEN`. Paste them into Vercel. **Do not commit or share them.** Losing `TOKEN_ENCRYPTION_KEYS`
   means every creator must reconnect.
3. Set `NEXT_PUBLIC_SITE_URL` to the real `https://` address. It is used to build the redirect URLs below.
4. Create the Google and Meta apps (next two sections) and add their keys.
5. Open **Connections** in the app and connect each account.

## YouTube (Google Cloud)

1. Google Cloud Console → create or pick a project → **APIs & Services → Library** → enable **YouTube Data API v3** and
   **YouTube Analytics API**.
2. **OAuth consent screen**: app name, support email, your domain, the links to `/privacy` and `/terms`.
3. Add these scopes (PBOS asks for exactly these and checks that they were granted):
   - `https://www.googleapis.com/auth/youtube.upload`
   - `https://www.googleapis.com/auth/youtube.readonly`
   - `https://www.googleapis.com/auth/yt-analytics.readonly`
4. **Credentials → Create credentials → OAuth client ID → Web application.** Authorized redirect URI:
   `https://YOUR-DOMAIN/api/connect/youtube/callback` (exactly, no trailing slash).
5. Put the client id and secret in `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

Things to know *(verify)*:

- While the consent screen is in **Testing**, only the test users you list can connect, and Google expires their refresh
  tokens after about a week. PBOS shows "needs reconnect" when that happens. Move to **In production** and complete
  verification for real users. `youtube.upload` is a sensitive scope, so verification applies.
- Google restricts videos uploaded through the API by projects that have not passed its compliance audit: they may be
  forced to private. Plan for the audit before promising creators public uploads.
- Uploads consume YouTube quota (a video insert is expensive against the default daily quota). `YOUTUBE_QUOTA_DAILY_UNITS`
  and `YOUTUBE_UPLOAD_DAILY_LIMIT` keep PBOS under it; the defaults are conservative.
- This is separate from **Sign in with Google**, which is a Clerk setting: `docs/AUTH-GOOGLE.md`.

## Instagram (Meta for Developers)

1. Create an app (use case: Instagram API with Facebook Login for Business, or the current equivalent) and note the **App ID**
   and **App Secret** (Settings → Basic) for `META_APP_ID` and `META_APP_SECRET`.
2. Valid OAuth redirect URI: `https://YOUR-DOMAIN/api/connect/instagram/callback`.
3. Permissions PBOS requests and requires: `instagram_basic`, `instagram_content_publish`, `instagram_manage_insights`,
   `pages_show_list`, `pages_read_engagement`. If a creator declines one, PBOS says which one is missing instead of failing
   later.
4. Webhooks (optional but recommended). In the app's webhook settings:
   - Callback URL `https://YOUR-DOMAIN/api/webhooks/meta`, verify token = your `META_WEBHOOK_VERIFY_TOKEN`.
   - Deauthorize callback `https://YOUR-DOMAIN/api/webhooks/meta/deauthorize`.
   - Data deletion request URL `https://YOUR-DOMAIN/api/webhooks/meta/data-deletion`. It returns a confirmation code and a
     status link on `/data-deletion`.
   - Incoming events are accepted only with a valid `X-Hub-Signature-256` signature.
5. `META_GRAPH_VERSION` is optional; the code has a default.

Things to know *(verify)*:

- The Instagram account must be a **Business or Creator** account linked to a **Facebook Page**. A personal account cannot
  publish through the API. PBOS shows a plain message when the account does not qualify, and lets the creator choose when
  several accounts are linked.
- In **Development mode**, only people with a role on the app (admin, developer, tester) can connect. Public use needs App
  Review and Business Verification for the permissions above. Reels have format and length limits that Meta can change.
- Instagram does not hold a scheduled post for you. PBOS publishes it when its scheduled time arrives, so something must
  call the cron endpoint.
- Long-lived Meta tokens expire. The hourly refresh job renews them early; if one cannot be renewed, the creator sees
  "needs reconnect".

## Scheduled jobs

Four endpoints do the background work. Each accepts only `Authorization: Bearer <CRON_SECRET>` (24+ characters) and answers
401 otherwise.

| Endpoint | What it does | How often |
| --- | --- | --- |
| `/api/cron/publish` | Publishes due Instagram posts and advances uploads | every 5 minutes |
| `/api/cron/sweep` | Parks jobs that got stuck, so nothing is retried blindly | every 5 minutes |
| `/api/cron/refresh-tokens` | Renews tokens that are about to expire | hourly |
| `/api/cron/sync-analytics` | Pulls fresh numbers from each connected account | daily |

Two ways to call them:

- **GitHub Actions (included).** `.github/workflows/cron.yml` runs on GitHub's schedule. Add two repository secrets,
  `PBOS_URL` (your site, no trailing slash) and `CRON_SECRET` (same value as in Vercel). GitHub can delay a scheduled run by
  several minutes, so Instagram posts go out *about* on time.
- **Vercel Cron** if your plan allows the frequency (the free plan runs a job once a day, which is not enough for the
  five-minute jobs).

## How tokens are protected

- Access and refresh tokens are encrypted with AES-256-GCM before they are stored, with the creator, platform and column bound in as
  authenticated data (so a token copied to another row will not decrypt), and a key version so keys can rotate (`TOKEN_ENCRYPTION_KEYS=2:<new>,1:<old>`).
- The database refuses a plaintext token, and the signed-in role cannot read the token columns at all. Only server code with
  the service key can.
- The OAuth `state` is a random value held in a signed cookie that is cleared after the callback, and PKCE is used, so a crafted link cannot connect someone else's account.
- Disconnecting tries to revoke the token at the platform (best effort: if Google or Meta cannot be reached, PBOS still removes its own copy) and deletes the synced data.

## If something does not work

| You see | Likely cause |
| --- | --- |
| "Connections are not set up on this deployment" | A Google, Meta, key or secret variable is missing. `.env.example` lists them all. |
| Redirect error at Google or Meta | The redirect URI does not match exactly, including `https://` and no trailing slash. |
| "Needs reconnect" after about a week | Google app still in Testing mode, or the Meta token could not be renewed. |
| Instagram post stays "scheduled" | Nothing is calling `/api/cron/publish`. Check the GitHub workflow and its two secrets. |
| Post in "needs review" | PBOS could not tell whether it went out. Check the account, then mark it posted or queue it again. |
| Meta says the account cannot publish | It is not a Business or Creator account, or is not linked to a Page. |
