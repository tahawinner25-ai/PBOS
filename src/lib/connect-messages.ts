/** Fixed messages for the `?error=` and `?connected=` codes the OAuth routes redirect with. */

export const CONNECT_ERRORS: Record<string, { title: string; hint: string }> = {
  denied: { title: 'The connection was cancelled.', hint: 'Nothing was connected. You can try again whenever you like.' },
  state: { title: 'The sign-in could not be verified.', hint: 'This protects your account from forged callbacks. Start the connection again from this page, in the same browser.' },
  scopes: { title: 'Some permissions were not granted.', hint: 'PBOS needs all three YouTube permissions (upload, read channel, read analytics). Connect again and keep every box ticked.' },
  permissions: { title: 'Some Instagram permissions were not granted.', hint: 'Publishing and analytics need every permission on the list. Connect again and approve them all. Nothing was kept.' },
  no_instagram: { title: 'No Instagram professional account was found.', hint: 'Instagram must be a Business or Creator account linked to a Facebook Page you manage. Link it in Instagram settings, then connect again.' },
  no_channel: { title: 'That Google account has no YouTube channel.', hint: 'Create a channel on YouTube first, or choose a different Google account.' },
  no_refresh_token: { title: 'Google did not allow long-term access.', hint: 'Remove PBOS at myaccount.google.com → Security → Third-party access, then connect again.' },
  linked_elsewhere: { title: 'That account is already connected to another PBOS user.', hint: 'Each YouTube channel or Instagram account can belong to one PBOS account. Disconnect it there first.' },
  provider: { title: 'The platform returned an error.', hint: 'Try again in a minute. If it keeps happening, the app may still be in test mode (see the notes below).' },
  server: { title: 'Something went wrong on our side.', hint: 'Nothing was connected. Try again in a moment.' },
  rate_limited: { title: 'Too many attempts.', hint: 'Wait a minute and try again.' },
  not_configured: { title: 'Connections are not set up on this deployment yet.', hint: 'The site owner needs to add the server settings listed below.' },
  youtube_not_configured: { title: 'YouTube is not set up on this deployment.', hint: 'The site owner needs to add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.' },
  instagram_not_configured: { title: 'Instagram is not set up on this deployment.', hint: 'The site owner needs to add META_APP_ID and META_APP_SECRET.' },
  unknown_platform: { title: 'Unknown platform.', hint: 'Use the Connect buttons on this page.' },
};

export const connectError = (code: string | undefined) => (code ? CONNECT_ERRORS[code] ?? null : null);

export const CONNECTED_LABEL: Record<string, string> = { youtube: 'YouTube is connected.', instagram: 'Instagram is connected.' };
