/**
 * Image generation through the OpenAI Images API. Pure: the network is injected, so the request shape,
 * the error mapping and the "what came back is really a JPEG" check are unit-tested without a key.
 *
 * Choices that matter:
 *  - JPEG output. Instagram's publishing API accepts JPEG only, so a generated image can go straight out.
 *  - The error messages never include the prompt, the API key or the provider's raw error body.
 *  - What the provider returns is checked by its first bytes before it is accepted; it is not trusted.
 */
import { MEDIA_MAX_BYTES, sniffMedia } from '../media-sniff';

export type Aspect = 'square' | 'landscape' | 'portrait';
export const ASPECTS: Record<Aspect, { label: string; hint: string }> = {
  square: { label: 'Square (1:1)', hint: 'Works for Instagram feed posts and carousels.' },
  landscape: { label: 'Landscape (3:2)', hint: 'Works for Instagram feed posts and YouTube thumbnails.' },
  portrait: { label: 'Portrait', hint: 'Good for Stories and covers. Check the size shown: Instagram feed photos need 4:5 or wider.' },
};
export const IMAGE_PROMPT_MIN = 8;
export const IMAGE_PROMPT_MAX = 1000;
export type Quality = 'low' | 'medium' | 'high';

export type ImageRequest = { prompt: string; aspect: Aspect; quality?: Quality };
export type ImageSuccess = { ok: true; bytes: Uint8Array; mime: 'image/jpeg'; width: number; height: number; provider: 'openai'; model: string };
export type ImageFailureReason = 'not_configured' | 'refused' | 'rate_limited' | 'timeout' | 'network' | 'http_error' | 'bad_response';
export type ImageFailure = { ok: false; reason: ImageFailureReason; message: string };
export type ImageResult = ImageSuccess | ImageFailure;

export type OpenAiImageConfig = { apiKey?: string; model?: string; baseUrl?: string; timeoutMs?: number; fetchImpl?: typeof fetch };

export const DEFAULT_IMAGE_MODEL = 'gpt-image-1';

/** Model names are placed in the request body only if they look like model names. */
export function safeModel(raw: string | undefined): string {
  return raw && /^[a-z0-9][a-z0-9._-]{1,80}$/i.test(raw) ? raw : DEFAULT_IMAGE_MODEL;
}

/** Sizes the API accepts. The gpt-image-2 family also takes arbitrary sizes, which gives a true 4:5 portrait. */
export function sizeFor(aspect: Aspect, model: string): { size: string; width: number; height: number } {
  if (aspect === 'square') return { size: '1024x1024', width: 1024, height: 1024 };
  if (aspect === 'landscape') return { size: '1536x1024', width: 1536, height: 1024 };
  return model.startsWith('gpt-image-2') ? { size: '1024x1280', width: 1024, height: 1280 } : { size: '1024x1536', width: 1024, height: 1536 };
}

/** Instagram feed photos must be between 4:5 and 1.91:1. Returns null when the size is unknown. */
export function instagramFeedRatioOk(width: number | null | undefined, height: number | null | undefined): boolean | null {
  if (!width || !height || width <= 0 || height <= 0) return null;
  const r = width / height;
  return r >= 0.8 - 1e-9 && r <= 1.91 + 1e-9;
}

const fail = (reason: ImageFailureReason, message: string): ImageFailure => ({ ok: false, reason, message });

function decodeBase64(b64: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/=\s]+$/.test(b64) || b64.length > Math.ceil((MEDIA_MAX_BYTES * 4) / 3) + 8) return null;
  try {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  } catch {
    return null;
  }
}

export async function generateOpenAiImage(cfg: OpenAiImageConfig, req: ImageRequest): Promise<ImageResult> {
  if (!cfg.apiKey) return fail('not_configured', 'Image generation is not set up on this deployment (OPENAI_API_KEY is missing).');
  const model = safeModel(cfg.model);
  const { size, width, height } = sizeFor(req.aspect, model);
  const doFetch = cfg.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 100_000);
  try {
    const res = await doFetch(`${cfg.baseUrl ?? 'https://api.openai.com'}/v1/images/generations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model, prompt: req.prompt, n: 1, size, quality: req.quality ?? 'medium', output_format: 'jpeg', output_compression: 90, moderation: 'auto' }),
      signal: controller.signal,
    });
    if (!res.ok) {
      let code = '';
      try {
        const body = (await res.json()) as { error?: { code?: unknown; type?: unknown } };
        code = `${typeof body.error?.code === 'string' ? body.error.code : ''} ${typeof body.error?.type === 'string' ? body.error.type : ''}`.toLowerCase();
      } catch { /* the body is only used to recognise a refusal */ }
      if (res.status === 400 && /moderation|content_policy|safety/.test(code)) return fail('refused', 'The image provider declined this description. Describe something different and try again.');
      if (res.status === 429) return fail('rate_limited', 'The image provider is busy or its limit was reached. Try again in a minute.');
      if (res.status === 401 || res.status === 403) {
        console.error(`[images] provider rejected credentials (HTTP ${res.status})`);
        return fail('http_error', 'The image service is not available right now. The site owner has been notified in the server log.');
      }
      console.error(`[images] provider error HTTP ${res.status}`);
      return fail('http_error', 'The image provider returned an error. Try again.');
    }
    const body = (await res.json()) as { data?: Array<{ b64_json?: unknown }> };
    const b64 = body.data?.[0]?.b64_json;
    if (typeof b64 !== 'string') return fail('bad_response', 'The image provider returned no image. Try again.');
    const bytes = decodeBase64(b64);
    if (!bytes || bytes.length === 0 || bytes.length > MEDIA_MAX_BYTES) return fail('bad_response', 'The image provider returned an unusable file. Try again.');
    const sniffed = sniffMedia(bytes);
    if (!sniffed || sniffed.mime !== 'image/jpeg') return fail('bad_response', 'The image provider returned a file that is not a JPEG, so it was discarded.');
    return { ok: true, bytes, mime: 'image/jpeg', width, height, provider: 'openai', model };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return fail('timeout', 'The image took too long to generate. Try again, or use a simpler description.');
    return fail('network', 'The image provider could not be reached. Try again.');
  } finally {
    clearTimeout(timer);
  }
}
