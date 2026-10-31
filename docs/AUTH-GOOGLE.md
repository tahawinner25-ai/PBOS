# Sign in with Google

PBOS uses Clerk for sign-in. Google sign-in is a Clerk setting, not code: when Google is enabled in Clerk, the sign-in and sign-up pages show a **Continue with Google** button above the email form (the layout is set in `src/lib/clerk-appearance.ts`).

## Development instance (works in minutes)

Clerk uses its own shared Google credentials for development, so there is nothing to create in Google Cloud.

1. [Clerk Dashboard](https://dashboard.clerk.com) → your application → **User & authentication** → **SSO connections** → **Add connection** → **For all users** → **Google**.
2. Save. Open `/login`: the button is there.

## Production instance (needs your own Google credentials)

1. In Clerk (Production instance): **SSO connections** → **Add connection** → **For all users** → **Google**. Turn on **Enable for sign-up and sign-in** and **Use custom credentials**. Keep the page open and copy the **Authorized Redirect URI** Clerk shows.
2. [Google Cloud Console](https://console.cloud.google.com) → **APIs & Services** → **Credentials** → **Create credentials** → **OAuth client ID** → **Web application**.
   - Authorized JavaScript origins: `https://your-domain.com` (and `https://www.your-domain.com`).
   - Authorized redirect URI: the exact value Clerk showed.
3. Paste the **Client ID** and **Client secret** into Clerk and save.
4. **OAuth consent screen**: fill in the app name, logo, support email, and your privacy-policy (`/privacy`) and terms (`/terms`) URLs. Set the status to **In production**; while it is "Testing", only listed test users (max 100) can sign in with Google.

Sign-in asks only for basic profile (`openid`, `email`, `profile`).

## This is not the YouTube connection

Signing in with Google and connecting YouTube are two separate grants:

| | Sign in with Google | Connect YouTube |
|---|---|---|
| Handled by | Clerk | PBOS (`/api/connect/youtube`) |
| Asks for | name, email, picture | upload videos, read channel, read analytics |
| Google Cloud client | Clerk's (dev) or the one you paste into Clerk (prod) | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` |
| Revoke | Clerk account settings | Connections page, or Google account permissions |

You can use the same Google Cloud project for both, but they are separate OAuth clients with separate redirect URIs. PBOS never asks for YouTube access at sign-in.
