/**
 * Email address rules shared by the agent's tool validation (which also runs in the browser bundle through the
 * activity feed) and the Gmail sender. Pure: no Node APIs, no imports.
 */

/** One plain mailbox: letters, digits and . _ % + - before the @; a real domain with a 2+ letter ending (or punycode). */
const ADDRESS = /^[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+(?:[A-Za-z]{2,24}|xn--[A-Za-z0-9-]{2,59})$/;

export const isEmailAddress = (value: unknown): value is string => typeof value === 'string' && value.length <= 254 && ADDRESS.test(value);

/** Every address-looking token in free text, lower-cased (used for "addresses the creator typed in this conversation"). */
export function emailsIn(text: string): string[] {
  const found = text.match(/[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9-]{1,63}\.)+[A-Za-z]{2,24}/g) ?? [];
  return found.map((e) => e.toLowerCase()).filter(isEmailAddress);
}

export const SUBJECT_MIN = 2;
export const SUBJECT_MAX = 150;
export const BODY_MIN = 10;
export const BODY_MAX = 3000;
