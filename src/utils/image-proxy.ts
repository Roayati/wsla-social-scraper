import { json } from './json';

const PROXY_IMAGE_PATH_PREFIX = '/image/';
const LONG_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const FALLBACK_IMAGE_URL =
  'https://s3.amazonaws.com/appforest_uf/f1637596911843x861021239461689300/default_profile_picture.png';
const ALLOWED_INSTAGRAM_IMAGE_HOST_SUFFIXES = ['.cdninstagram.com'];

function isAllowedInstagramImageHost(hostname: string): boolean {
  const normalizedHostname = hostname.toLowerCase();

  return (
    normalizedHostname === 'cdninstagram.com' ||
    ALLOWED_INSTAGRAM_IMAGE_HOST_SUFFIXES.some((suffix) => normalizedHostname.endsWith(suffix))
  );
}

function decodeImageUrlFromPath(pathname: string): string {
  if (!pathname.startsWith(PROXY_IMAGE_PATH_PREFIX)) {
    throw new Error('Image proxy route is malformed.');
  }

  const encodedUrl = pathname.slice(PROXY_IMAGE_PATH_PREFIX.length);

  if (!encodedUrl) {
    throw new Error('Missing encoded Instagram image URL.');
  }

  try {
    return decodeURIComponent(encodedUrl);
  } catch {
    throw new Error('Invalid encoded Instagram image URL.');
  }
}

function parseAndValidateInstagramImageUrl(rawUrl: string): URL {
  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Decoded value is not a valid URL.');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Only http and https image URLs are supported.');
  }

  if (!isAllowedInstagramImageHost(parsed.hostname)) {
    throw new Error('Only Instagram CDN image hosts are allowed.');
  }

  return parsed;
}

function buildImageHeaders(upstreamHeaders: Headers): Headers {
  const headers = new Headers();
  const contentType = upstreamHeaders.get('content-type');

  if (contentType) {
    headers.set('content-type', contentType);
  }

  headers.set('access-control-allow-origin', '*');
  headers.set('cache-control', LONG_CACHE_CONTROL);

  return headers;
}

async function fetchImageWithFallback(upstreamImageUrl: URL): Promise<Response> {
  try {
    const upstreamResponse = await fetch(upstreamImageUrl.toString(), {
      method: 'GET',
      redirect: 'follow',
    });

    if (upstreamResponse.ok && upstreamResponse.status < 400) {
      return upstreamResponse;
    }
  } catch {
    // Fall through and return the fallback image.
  }

  return fetch(FALLBACK_IMAGE_URL, {
    method: 'GET',
    redirect: 'follow',
  });
}

export function buildProxiedImageUrl(request: Request, originalUrl: string): string {
  const requestUrl = new URL(request.url);
  const encodedOriginalUrl = encodeURIComponent(originalUrl);

  return `${requestUrl.origin}${PROXY_IMAGE_PATH_PREFIX}${encodedOriginalUrl}`;
}

export async function proxyInstagramImage(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const cache = (caches as CacheStorage & { default: Cache }).default;
  const cacheKey = new Request(request.url, { method: 'GET' });
  const cached = await cache.match(cacheKey);

  if (cached) {
    return cached;
  }

  let upstreamImageUrl: URL;

  try {
    const decodedUrl = decodeImageUrlFromPath(requestUrl.pathname);
    upstreamImageUrl = parseAndValidateInstagramImageUrl(decodedUrl);
  } catch (error) {
    const details = error instanceof Error ? error.message : 'Invalid image proxy request.';
    const status = details.includes('allowed') ? 403 : 400;

    return json({ error: 'Invalid image proxy URL', details }, status);
  }

  const upstreamResponse = await fetchImageWithFallback(upstreamImageUrl);

  if (!upstreamResponse.ok || upstreamResponse.status >= 400) {
    return json(
      {
        error: 'Failed to fetch Instagram image',
        details: `Fallback image request returned HTTP ${upstreamResponse.status}.`,
      },
      502
    );
  }

  const proxiedResponse = new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: buildImageHeaders(upstreamResponse.headers),
  });

  await cache.put(cacheKey, proxiedResponse.clone());

  return proxiedResponse;
}
