import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Small, dependency-free helpers for values that travel through the browser (cookies, query strings)
 * and must not be forged: HMAC-SHA256 over a base64url JSON payload.
 *
 * Signing proves the server issued the value; it does NOT hide it. Do not put secrets in a signed
 * value unless it is also encrypted (see integrations/crypto.ts).
 */

export const MIN_SECRET_LENGTH = 32;

export class WeakSecretError extends Error {
  constructor(name: string) {
    super(`${name} must be set to a random string of at least ${MIN_SECRET_LENGTH} characters.`);
  }
}

/** Throws when a signing secret is missing or too short, so a misconfigured deploy fails loudly. */
export function assertSecret(secret: string | undefined, name: string): string {
  if (!secret || secret.length < MIN_SECRET_LENGTH) throw new WeakSecretError(name);
  return secret;
}

export const b64url = (input: Buffer | string): string => Buffer.from(input).toString('base64url');

export function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/** Constant-time string comparison. Different lengths compare false without leaking where they differ. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** `<base64url(json)>.<base64url(hmac)>` */
export function packSigned(data: unknown, secret: string): string {
  const body = b64url(JSON.stringify(data));
  return `${body}.${sign(body, secret)}`;
}

/** Returns the payload when the signature is valid, otherwise null. Callers enforce their own expiry. */
export function unpackSigned<T>(value: string | undefined | null, secret: string): T | null {
  if (!value || value.length > 4096) return null;
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  if (!safeEqual(signature, sign(body, secret))) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}
