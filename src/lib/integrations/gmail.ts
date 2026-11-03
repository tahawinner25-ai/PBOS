import { BODY_MAX, BODY_MIN, SUBJECT_MAX, SUBJECT_MIN, isEmailAddress } from '../email-address';
import { IntegrationError } from './errors';
import { getGmailToken, NotConnectedError, ReauthRequiredError } from './connections';
import type { Env } from './ports';
import { requestJson } from './http';
import type { Deps } from './types';

/**
 * Sending email through the creator's own Gmail (scope gmail.send only: PBOS cannot read, list or delete mail).
 *
 * Safety rules that live here, in code:
 *  - one recipient, checked against a strict address pattern (no names, no commas, no angle brackets, no line breaks),
 *    so a crafted value can never add a second recipient or a header;
 *  - the subject may not contain line breaks, and non-ASCII text is encoded as RFC 2047 words, so it cannot inject headers;
 *  - plain text only (no HTML, no attachments, no tracking pixels);
 *  - ONE attempt. A timeout does not prove the message was not sent, and a blind retry could send it twice, so an
 *    unclear outcome is reported as unclear and left to the creator.
 */

export const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

export type OutgoingEmail = { to: string; subject: string; body: string };

export class EmailRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailRefusedError';
  }
}

/** Splits text into RFC 2047 encoded words (36 bytes each, so every header line stays under 78 characters) and never cuts a character in half. */
function encodeWords(value: string): string {
  const words: string[] = [];
  let chunk = '';
  let bytes = 0;
  for (const ch of value) {
    const size = Buffer.byteLength(ch, 'utf8');
    if (bytes + size > 36) {
      words.push(chunk);
      chunk = '';
      bytes = 0;
    }
    chunk += ch;
    bytes += size;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, 'utf8').toString('base64')}?=`).join('\r\n ');
}

const encodeSubject = (subject: string): string => (/^[\x20-\x7e]*$/.test(subject) ? subject : encodeWords(subject));

/** The finished message (RFC 5322, plain text, UTF-8) before base64url. Throws EmailRefusedError for anything unsafe. */
export function buildMime(mail: OutgoingEmail): string {
  if (!isEmailAddress(mail.to)) throw new EmailRefusedError('The recipient is not a single valid email address.');
  if (/[\r\n\0]/.test(mail.subject)) throw new EmailRefusedError('The subject cannot contain line breaks.');
  const subject = mail.subject.trim();
  if (subject.length < SUBJECT_MIN || subject.length > SUBJECT_MAX) throw new EmailRefusedError(`The subject must be ${SUBJECT_MIN} to ${SUBJECT_MAX} characters.`);
  if (mail.body.includes('\0')) throw new EmailRefusedError('The message contains an invalid character.');
  const body = mail.body.replace(/\r\n|\r|\n/g, '\r\n').trim();
  if (body.length < BODY_MIN || body.length > BODY_MAX + 200) throw new EmailRefusedError(`The message must be ${BODY_MIN} to ${BODY_MAX} characters.`);

  const encoded = Buffer.from(body, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
  return [
    `To: ${mail.to}`,
    `Subject: ${encodeSubject(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    encoded,
  ].join('\r\n');
}

export const toRaw = (mail: OutgoingEmail): string => Buffer.from(buildMime(mail), 'utf8').toString('base64url');

/** One call to Gmail, one attempt. Returns Gmail's own message id as proof it accepted the message. */
export async function sendGmail(deps: Deps, accessToken: string, mail: OutgoingEmail): Promise<{ id: string; threadId: string | null }> {
  const body = await requestJson<{ id?: string; threadId?: string }>(
    deps,
    GMAIL_SEND_URL,
    { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: toRaw(mail) }) },
    { platform: 'gmail', maxAttempts: 1, timeoutMs: 20_000 },
  );
  if (!body.id) throw new IntegrationError({ kind: 'unknown', platform: 'gmail', code: 'no_message_id', detail: 'Gmail did not return a message id' });
  return { id: body.id, threadId: body.threadId ?? null };
}

export type SendOutcome =
  | { ok: true; id: string; from: string | null }
  | { ok: false; reason: 'not_configured' | 'not_connected' | 'reauth' | 'refused' | 'rejected' | 'unclear' | 'failed'; message: string };

/**
 * Sends one approved email as the creator. Never throws for expected failures. Records an event that holds the
 * Gmail message id and nothing else: not the recipient, the subject or the text.
 */
export async function sendEmailAs(env: Pick<Env, 'deps' | 'conns' | 'events' | 'gmail'>, creatorId: string, mail: OutgoingEmail): Promise<SendOutcome> {
  if (!env.gmail) return { ok: false, reason: 'not_configured', message: 'Gmail is not set up on this deployment (the Google app credentials are missing).' };
  try {
    buildMime(mail); // refuse unsafe input before any token is touched
    const { token, conn } = await getGmailToken({ deps: env.deps, conns: env.conns, events: env.events, creatorId, google: env.gmail });
    const sent = await sendGmail(env.deps, token, mail);
    await env.events.record(creatorId, 'gmail', 'email_sent', { message_id: sent.id });
    return { ok: true, id: sent.id, from: conn.meta && typeof conn.meta.email === 'string' ? conn.meta.email : null };
  } catch (err) {
    if (err instanceof EmailRefusedError) return { ok: false, reason: 'refused', message: err.message };
    if (err instanceof NotConnectedError) return { ok: false, reason: 'not_connected', message: 'Gmail is not connected. Connect it on the Connections page, then ask again.' };
    if (err instanceof ReauthRequiredError) return { ok: false, reason: 'reauth', message: 'Gmail needs to be reconnected on the Connections page before anything can be sent.' };
    if (err instanceof IntegrationError) {
      console.error(`[gmail] send failed: ${err.kind} ${err.code ?? ''} ${err.status ?? ''}`);
      if (err.kind === 'auth') {
        await env.conns.update(creatorId, 'gmail', { status: 'needs_reauth', lastError: 'Gmail no longer accepts the saved sign-in.' }).catch(() => undefined);
        return { ok: false, reason: 'reauth', message: 'Gmail no longer accepts the saved sign-in. Reconnect it on the Connections page.' };
      }
      // A timeout, a network drop or a 5xx cannot prove the message was NOT sent. Say so and do not retry.
      if (err.kind === 'transient' || err.kind === 'rate_limit' || err.kind === 'unknown') {
        return { ok: false, reason: 'unclear', message: 'Gmail did not confirm the send. The email may or may not have gone out: check your Sent folder before trying again. PBOS will not resend it on its own.' };
      }
      return { ok: false, reason: 'rejected', message: `Gmail refused it: ${err.userMessage}` };
    }
    console.error('[gmail] unexpected error', err instanceof Error ? err.name : typeof err);
    return { ok: false, reason: 'failed', message: 'The email could not be sent because of a problem on our side. Check your Sent folder before trying again.' };
  }
}
