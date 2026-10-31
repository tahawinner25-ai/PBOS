#!/usr/bin/env node
// Prints fresh random secrets for the server settings that need them. It writes NOTHING to disk and never reads
// your existing values: copy each line into .env.local (development) or Vercel → Settings → Environment Variables.
// Run it again to rotate. For TOKEN_ENCRYPTION_KEYS keep the OLD key after the new one, e.g. "2:<new>,1:<old>",
// so tokens encrypted with the old key can still be read until they are refreshed.
import { randomBytes } from 'node:crypto';

const b64 = (n) => randomBytes(n).toString('base64');
const hex = (n) => randomBytes(n).toString('hex');

console.log('# Generated just now. Treat every line below as a password: do not commit it or paste it into a chat.');
console.log(`TOKEN_ENCRYPTION_KEYS=1:${b64(32)}`);
console.log(`OAUTH_STATE_SECRET=${hex(32)}`);
console.log(`DEMO_SESSION_SECRET=${hex(32)}`);
console.log(`CRON_SECRET=${hex(32)}`);
console.log(`META_WEBHOOK_VERIFY_TOKEN=${hex(24)}`);
