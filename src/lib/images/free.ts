/**
 * Free image generation through Pollinations (image.pollinations.ai): no key, no card. Used when OPENAI_API_KEY is not set,
 * and as a fallback when the OpenAI call fails. Pure: the network is injected, so the request and the "what came back is
 * really a JPEG" check are unit-tested. The description is sent to Pollinations as part of the request URL, which the
 * interface says plainly.
 */
import { MEDIA_MAX_BYTES, sniffMedia } from '../media-sniff';
import type { Aspect, ImageFailure, ImageResult } from './openai';

export const FREE_IMAGE_MODEL = 'pollinations-flux';

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

export async function generateFreeImage(req: { prompt: string; aspect: Aspect }, opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<ImageResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const { width, height } = SIZES[req.aspect];
  let last: ImageFailure = fail('network', 'The free image service could not be reached. Try again.');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await doFetch(freeImageUrl(req.prompt, req.aspect, Math.floor(Math.random() * 1_000_000)), { signal: AbortSignal.timeout(opts.timeoutMs ?? 28_000), redirect: 'follow' });
      if (res.status === 429) { last = fail('rate_limited', 'The free image service is busy. Try again in a minute.'); continue; }
      if (!res.ok) { last = fail('http_error', 'The free image service returned an error. Try again.'); continue; }
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
