/**
 * Free image generation through Pollinations (image.pollinations.ai): no key, no card. Used when OPENAI_API_KEY is not set,
 * and as a fallback when the OpenAI call fails. Pure: the network is injected, so the request and the "what came back is
 * really a JPEG" check are unit-tested. The description is sent to Pollinations as part of the request URL, which the
 * interface says plainly.
 */
import { MEDIA_MAX_BYTES, sniffMedia } from '../media-sniff';
import type { Aspect, ImageFailure, ImageResult } from './openai';

export const FREE_IMAGE_MODEL = 'pollinations-flux';

/**
 * The anonymous tier allows ONE image per ~45 seconds per IP address, and a hosting platform shares addresses between
 * many sites, so a request often meets "402 FREE_LIMIT" with a Retry-After. We wait that long (inside a time budget)
 * and try again. An optional free key (POLLINATIONS_API_KEY, from enter.pollinations.ai) lifts the shared limit.
 */
const BUDGET_MS = 54_000;
const MAX_WAIT_S = 46;

const SIZES: Record<Aspect, { width: number; height: number }> = {
  square: { width: 1024, height: 1024 },
  landscape: { width: 1152, height: 768 },
  // 4:5, which Instagram feed photos accept.
  portrait: { width: 832, height: 1040 },
};

const fail = (reason: ImageFailure['reason'], message: string): ImageFailure => ({ ok: false, reason, message });

export function freeImageUrl(prompt: string, aspect: Aspect, seed: number): string {
  const { width, height } = SIZES[aspect];
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${width}&height=${height}&model=flux&nologo=true&enhance=false&seed=${seed}`;
}

export type FreeImageOptions = { fetchImpl?: typeof fetch; apiKey?: string; sleep?: (ms: number) => Promise<void>; now?: () => number; budgetMs?: number };

export async function generateFreeImage(req: { prompt: string; aspect: Aspect }, opts: FreeImageOptions = {}): Promise<ImageResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const started = now();
  const budget = opts.budgetMs ?? BUDGET_MS;
  const { width, height } = SIZES[req.aspect];
  let last: ImageFailure = fail('network', 'The free image service could not be reached. Try again.');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const left = budget - (now() - started);
    if (left < 6_000) break;
    try {
      const res = await doFetch(freeImageUrl(req.prompt, req.aspect, Math.floor(Math.random() * 1_000_000)), {
        signal: AbortSignal.timeout(Math.min(left, 30_000)),
        redirect: 'follow',
        ...(opts.apiKey ? { headers: { authorization: `Bearer ${opts.apiKey}` } } : {}),
      });
      if (res.status === 402 || res.status === 429) {
        const wait = Math.max(1, Math.min(Number.parseInt(res.headers.get('retry-after') ?? '', 10) || 15, MAX_WAIT_S));
        last = fail('rate_limited', `The free image service allows about one image every 45 seconds (it is shared with other sites). Wait ${wait} seconds and try again${opts.apiKey ? '.' : ', or add a free POLLINATIONS_API_KEY in Vercel to remove the shared limit.'}`);
        if (budget - (now() - started) > wait * 1000 + 8_000) { await sleep(wait * 1000 + 500); continue; }
        break;
      }
      if (!res.ok) { last = fail('http_error', `The free image service returned an error (HTTP ${res.status}). Try again.`); await sleep(1500); continue; }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length === 0 || bytes.length > MEDIA_MAX_BYTES) return fail('bad_response', 'The free image service returned an unusable file. Try again.');
      const sniffed = sniffMedia(bytes);
      if (!sniffed || sniffed.mime !== 'image/jpeg') return fail('bad_response', 'The free image service returned a file that is not a JPEG, so it was discarded.');
      return { ok: true, bytes, mime: 'image/jpeg', width, height, provider: 'pollinations', model: FREE_IMAGE_MODEL };
    } catch (err) {
      last = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError') ? fail('timeout', 'The image took too long to generate. Try again, or use a simpler description.') : fail('network', 'The free image service could not be reached. Try again.');
    }
  }
  return last;
}
