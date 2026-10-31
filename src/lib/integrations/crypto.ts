import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Token encryption at rest: AES-256-GCM with a versioned key ring.
 *
 * Envelope stored in the database:  v<keyVersion>:<iv>:<authTag>:<ciphertext>   (base64url parts)
 *
 *  - A fresh random 96-bit IV per encryption, so the same token never encrypts to the same text.
 *  - The auth tag makes tampering detectable: a modified envelope fails to decrypt.
 *  - Additional authenticated data (AAD) binds a ciphertext to <creator>/<platform>/<column>. Copying
 *    an encrypted value to another row or column makes decryption fail.
 *  - Key rotation: put the new key first in TOKEN_ENCRYPTION_KEYS ("2:<b64>,1:<b64>"). New writes use
 *    version 2, old rows still decrypt with version 1, and `needsRotation` tells the refresh job which
 *    rows to rewrite. Remove an old key only once no row uses it.
 *
 * Errors never include the plaintext, the key or the envelope.
 */

export type Keyring = { current: number; keys: ReadonlyMap<number, Buffer> };

export type CryptoErrorCode = 'bad_key' | 'bad_envelope' | 'unknown_key_version' | 'auth_failed';

export class TokenCryptoError extends Error {
  constructor(readonly code: CryptoErrorCode) {
    super(`token crypto failure: ${code}`);
    this.name = 'TokenCryptoError';
  }
}

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ENVELOPE = /^v(\d{1,6}):([A-Za-z0-9_-]+):([A-Za-z0-9_-]+):([A-Za-z0-9_-]*)$/;

function decodeKey(b64: string): Buffer {
  // Accept standard base64 and base64url, with or without padding.
  const key = Buffer.from(b64.trim().replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (key.length !== KEY_BYTES) throw new TokenCryptoError('bad_key');
  return key;
}

/**
 * Builds the key ring from environment-style input. `keys` is "version:base64key" pairs separated by
 * commas, newest first. `single` is a lone base64 key treated as version 1. Returns null when neither
 * is set; throws `bad_key` when a key is malformed (a half-working key ring must not start).
 */
export function parseKeyring(input: { keys?: string | undefined; single?: string | undefined }): Keyring | null {
  const entries: Array<[number, Buffer]> = [];
  if (input.keys && input.keys.trim()) {
    for (const part of input.keys.split(',')) {
      const match = /^\s*(\d{1,6})\s*:\s*(\S+)\s*$/.exec(part);
      if (!match) throw new TokenCryptoError('bad_key');
      entries.push([Number(match[1]), decodeKey(match[2])]);
    }
  } else if (input.single && input.single.trim()) {
    entries.push([1, decodeKey(input.single)]);
  }
  if (entries.length === 0) return null;
  const versions = new Set(entries.map(([v]) => v));
  if (versions.size !== entries.length) throw new TokenCryptoError('bad_key');
  return { current: entries[0][0], keys: new Map(entries) };
}

/** Context the ciphertext is bound to. Use the same value to encrypt and to decrypt. */
export const tokenAad = (creatorId: string, platform: string, column: string): string =>
  `pbos:token:v1:${creatorId}:${platform}:${column}`;

export function encryptToken(plaintext: string, ring: Keyring, aad: string): string {
  const key = ring.keys.get(ring.current);
  if (!key) throw new TokenCryptoError('unknown_key_version');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v${ring.current}:${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
}

export function decryptToken(envelope: string, ring: Keyring, aad: string): string {
  const match = ENVELOPE.exec(envelope);
  if (!match) throw new TokenCryptoError('bad_envelope');
  const key = ring.keys.get(Number(match[1]));
  if (!key) throw new TokenCryptoError('unknown_key_version');
  const iv = Buffer.from(match[2], 'base64url');
  const tag = Buffer.from(match[3], 'base64url');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new TokenCryptoError('bad_envelope');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(match[4], 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new TokenCryptoError('auth_failed');
  }
}

/** True when the envelope was written with an older key than the current one. */
export function needsRotation(envelope: string, ring: Keyring): boolean {
  const match = ENVELOPE.exec(envelope);
  return match ? Number(match[1]) !== ring.current : false;
}

/** For `scripts/gen-keys.mjs` and the docs: a new random 256-bit key as base64. */
export const generateKey = (): string => randomBytes(KEY_BYTES).toString('base64');
