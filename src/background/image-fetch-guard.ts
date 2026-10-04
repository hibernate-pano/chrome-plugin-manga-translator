/**
 * URL policy for the background image proxy.
 *
 * The content script cannot read cross-origin image bytes directly (the CDN
 * canvas taints), so it asks the service worker to fetch them. That makes the
 * worker a general-purpose fetcher driven by page content, which is exactly
 * the shape of an SSRF primitive: any page the user visits can ask it to
 * retrieve an internal-network URL and hand back the bytes.
 *
 * Two layers apply:
 *   1. this module — protocol and address checks, plus a byte budget;
 *   2. the caller in `background.ts` — sender authorisation, so the request
 *      path is limited to images the tab is actually displaying.
 */

/** Refuse absurd payloads before they reach the message channel. */
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

/** Fetch timeout; a hung CDN must not pin the worker. */
export const IMAGE_FETCH_TIMEOUT_MS = 20_000;

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Encode bytes as base64.
 *
 * Implemented directly rather than via `btoa(String.fromCharCode(...))`:
 * the string-building step is quadratic for multi-megabyte webtoon strips
 * (the previous implementation concatenated one character per byte), and it
 * depends on host quirks in how latin1 strings reach `btoa`. A lookup-table
 * encoder is linear, allocation-light, and identical everywhere the extension
 * runs — content script, service worker, and tests.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  // Indexing returns `string | undefined` under noUncheckedIndexedAccess; the
  // index is always masked to 0-63, so the lookup is total.
  const symbolAt = (index: number): string =>
    BASE64_ALPHABET.charAt(index & 0x3f);

  const parts: string[] = [];
  let chunk = '';
  let i = 0;

  for (; i + 2 < bytes.length; i += 3) {
    const triple =
      ((bytes[i] ?? 0) << 16) |
      ((bytes[i + 1] ?? 0) << 8) |
      (bytes[i + 2] ?? 0);
    chunk +=
      symbolAt(triple >> 18) +
      symbolAt(triple >> 12) +
      symbolAt(triple >> 6) +
      symbolAt(triple);
    if (chunk.length >= 8192) {
      parts.push(chunk);
      chunk = '';
    }
  }

  const remaining = bytes.length - i;
  if (remaining === 1) {
    const triple = (bytes[i] ?? 0) << 16;
    chunk += `${symbolAt(triple >> 18)}${symbolAt(triple >> 12)}==`;
  } else if (remaining === 2) {
    const triple = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8);
    chunk += `${symbolAt(triple >> 18)}${symbolAt(triple >> 12)}${symbolAt(
      triple >> 6
    )}=`;
  }

  if (chunk) {
    parts.push(chunk);
  }
  return parts.join('');
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '');
}

function isPrivateIpv4(host: string): boolean {
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) {
    return false;
  }
  const octets = match.slice(1, 5).map(Number);
  if (octets.some(octet => Number.isNaN(octet) || octet > 255)) {
    // Malformed literal: refuse rather than guess.
    return true;
  }
  const a = octets[0] ?? 0;
  const b = octets[1] ?? 0;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIpv6(host: string): boolean {
  if (!host.includes(':')) {
    return false;
  }
  if (host === '::1' || host === '::') return true;
  const mapped = host.match(/^::(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped?.[1]) {
    return isPrivateIpv4(mapped[1]);
  }
  if (host.startsWith('::ffff:')) {
    return true;
  }
  if (/^f[cd]/.test(host)) return true;
  if (/^fe[89ab]/.test(host)) return true;
  if (/^fec/.test(host)) return true;
  return false;
}

/**
 * True when the URL is safe for the worker to fetch on a page's behalf.
 *
 * Hostnames that are not IP literals are allowed through: DNS rebinding
 * cannot be prevented here, and the sender check in `background.ts` is the
 * primary control on who may ask.
 */
export function isSafeImageUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }
  const host = normalizeHost(parsed.hostname);
  if (!host) {
    return false;
  }
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return false;
  }
  if (host === 'metadata.google.internal') {
    return false;
  }
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) {
    return false;
  }
  return true;
}

/**
 * Fetch an image with the guards applied: validated URL, no credential
 * forwarding, timeout, byte cap, and an image content type.
 */
export async function fetchImageBytes(
  imageUrl: string
): Promise<
  | { success: true; base64: string; mimeType: string }
  | { success: false; error: string }
> {
  if (!isSafeImageUrl(imageUrl)) {
    return { success: false, error: 'Blocked image URL' };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(imageUrl, {
      signal: controller.signal,
      // Never forward the page's cookies to a third-party CDN.
      credentials: 'omit',
      redirect: 'follow',
    });
    if (!response.ok) {
      return {
        success: false,
        error: `Failed to fetch image: ${response.status}`,
      };
    }
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
      return { success: false, error: 'Image too large' };
    }
    const mimeType = (response.headers.get('content-type') ?? '')
      .split(';')[0]
      ?.trim()
      .toLowerCase();
    if (mimeType && !mimeType.startsWith('image/')) {
      return { success: false, error: 'Response is not an image' };
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      return { success: false, error: 'Image too large' };
    }
    return {
      success: true,
      base64: bytesToBase64(new Uint8Array(buffer)),
      mimeType:
        mimeType && mimeType.startsWith('image/') ? mimeType : 'image/jpeg',
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error && error.name === 'AbortError'
          ? 'Image fetch timed out'
          : error instanceof Error
            ? error.message
            : 'Failed to fetch image',
    };
  } finally {
    clearTimeout(timeout);
  }
}
