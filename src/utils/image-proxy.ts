import { json } from './json';

const PROXY_IMAGE_PATH_PREFIX = '/image/';
const LONG_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const FALLBACK_IMAGE_URL =
  'https://s3.amazonaws.com/appforest_uf/f1637596911843x861021239461689300/default_profile_picture.png';
const ALLOWED_INSTAGRAM_IMAGE_HOST_SUFFIXES = ['.cdninstagram.com'];
const ALLOWED_TIKTOK_IMAGE_HOST_SUFFIXES = [
  '.tiktokcdn.com',
  '.tiktokcdn-us.com',
  '.muscdn.com',
  '.byteimg.com',
  '.ibytedtos.com',
  '.byteoversea.com',
  '.akamaized.net',
];
const DEFAULT_TRANSFORM_QUALITY = 82;
const MAX_TRANSFORM_DIMENSION = 2000;
const MIN_QUALITY = 40;
const MAX_QUALITY = 95;
const ALLOWED_FIT_MODES = new Set(['contain', 'cover', 'scale-down', 'crop', 'pad']);
const ALLOWED_FORMATS = new Set(['auto', 'webp', 'avif', 'jpeg', 'png']);

type OutputImageFormat = 'webp' | 'avif' | 'jpeg' | 'png';
type RequestedImageFormat = OutputImageFormat | 'auto';

interface ImageTransformOptions {
  width?: number;
  height?: number;
  quality?: number;
  fit?: string;
  requestedFormat: RequestedImageFormat;
  outputFormat: OutputImageFormat;
  shouldTransform: boolean;
}

function isAllowedSocialImageHost(hostname: string): boolean {
  const normalizedHostname = hostname.toLowerCase();

  return (
    normalizedHostname === 'cdninstagram.com' ||
    ALLOWED_INSTAGRAM_IMAGE_HOST_SUFFIXES.some((suffix) => normalizedHostname.endsWith(suffix)) ||
    ALLOWED_TIKTOK_IMAGE_HOST_SUFFIXES.some((suffix) => normalizedHostname.endsWith(suffix))
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

function parseAndValidateSocialImageUrl(rawUrl: string): URL {
  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Decoded value is not a valid URL.');
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Only http and https image URLs are supported.');
  }

  if (!isAllowedSocialImageHost(parsed.hostname)) {
    throw new Error('Only approved Instagram/TikTok image hosts are allowed.');
  }

  return parsed;
}

function parseIntegerParam(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return parsed;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeRequestedFormat(value: string | null): RequestedImageFormat {
  if (!value) {
    return 'auto';
  }

  const normalized = value.toLowerCase();

  if (ALLOWED_FORMATS.has(normalized)) {
    return normalized as RequestedImageFormat;
  }

  return 'auto';
}

export function detectPreferredFormat(request: Request): OutputImageFormat {
  const accept = request.headers.get('accept')?.toLowerCase() ?? '';

  if (accept.includes('image/avif')) {
    return 'avif';
  }

  if (accept.includes('image/webp')) {
    return 'webp';
  }

  return 'jpeg';
}

export function parseImageTransformOptions(request: Request): ImageTransformOptions {
  const url = new URL(request.url);
  const widthParam = parseIntegerParam(url.searchParams.get('w'));
  const heightParam = parseIntegerParam(url.searchParams.get('h'));
  const qualityParam = parseIntegerParam(url.searchParams.get('q'));
  const fitParam = url.searchParams.get('fit')?.toLowerCase();
  const requestedFormat = normalizeRequestedFormat(url.searchParams.get('format'));
  const outputFormat = requestedFormat === 'auto' ? detectPreferredFormat(request) : requestedFormat;
  const width = typeof widthParam === 'number' && widthParam > 0 ? clamp(widthParam, 1, MAX_TRANSFORM_DIMENSION) : undefined;
  const height =
    typeof heightParam === 'number' && heightParam > 0 ? clamp(heightParam, 1, MAX_TRANSFORM_DIMENSION) : undefined;
  const quality =
    typeof qualityParam === 'number' && qualityParam > 0
      ? clamp(qualityParam, MIN_QUALITY, MAX_QUALITY)
      : DEFAULT_TRANSFORM_QUALITY;
  const fit = fitParam && ALLOWED_FIT_MODES.has(fitParam) ? fitParam : undefined;
  const shouldTransform = Boolean(width || height || quality || outputFormat);

  return {
    width,
    height,
    quality,
    fit,
    requestedFormat,
    outputFormat,
    shouldTransform,
  };
}

function formatToContentType(format: OutputImageFormat): string {
  switch (format) {
    case 'avif':
      return 'image/avif';
    case 'webp':
      return 'image/webp';
    case 'png':
      return 'image/png';
    default:
      return 'image/jpeg';
  }
}

function buildImageHeaders(upstreamHeaders: Headers, outputFormat?: OutputImageFormat): Headers {
  const headers = new Headers();
  const contentType = upstreamHeaders.get('content-type');

  if (outputFormat) {
    headers.set('content-type', formatToContentType(outputFormat));
  } else if (contentType) {
    headers.set('content-type', contentType);
  } else {
    headers.set('content-type', 'image/jpeg');
  }

  headers.set('access-control-allow-origin', '*');
  headers.set('cache-control', LONG_CACHE_CONTROL);
  headers.set('vary', 'accept');

  return headers;
}

function buildCfImageOptions(options: ImageTransformOptions): { image: Record<string, unknown> } {
  const image: Record<string, unknown> = {
    quality: options.quality ?? DEFAULT_TRANSFORM_QUALITY,
    format: options.outputFormat,
  };

  if (options.width) {
    image.width = options.width;
  }

  if (options.height) {
    image.height = options.height;
  }

  if (options.fit) {
    image.fit = options.fit;
  }

  return { image };
}

async function fetchImageWithTransforms(upstreamImageUrl: URL, options: ImageTransformOptions): Promise<Response> {
  const rawFetch = () =>
    fetch(upstreamImageUrl.toString(), {
      method: 'GET',
      redirect: 'follow',
    });

  if (!options.shouldTransform) {
    return rawFetch();
  }

  const transformOptions = buildCfImageOptions(options);

  try {
    const transformedResponse = await fetch(upstreamImageUrl.toString(), {
      method: 'GET',
      redirect: 'follow',
      cf: transformOptions,
    });

    if (transformedResponse.ok) {
      return transformedResponse;
    }

    return rawFetch();
  } catch {
    return rawFetch();
  }
}

async function fetchFallbackImageWithTransforms(options: ImageTransformOptions): Promise<Response> {
  const fallbackUrl = new URL(FALLBACK_IMAGE_URL);

  return fetchImageWithTransforms(fallbackUrl, options);
}

async function fetchImageWithFallback(upstreamImageUrl: URL, options: ImageTransformOptions): Promise<Response> {
  try {
    const upstreamResponse = await fetchImageWithTransforms(upstreamImageUrl, options);

    if (upstreamResponse.ok && upstreamResponse.status < 400) {
      return upstreamResponse;
    }
  } catch {
    // Fall through and return the fallback image.
  }

  return fetchFallbackImageWithTransforms(options);
}

function buildImageResponse(upstreamResponse: Response, options: ImageTransformOptions): Response {
  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: buildImageHeaders(upstreamResponse.headers, options.shouldTransform ? options.outputFormat : undefined),
  });
}

function buildImageCacheKey(request: Request, options: ImageTransformOptions): Request {
  const url = new URL(request.url);

  if (options.width) {
    url.searchParams.set('w', String(options.width));
  }

  if (options.height) {
    url.searchParams.set('h', String(options.height));
  }

  if (options.quality) {
    url.searchParams.set('q', String(options.quality));
  }

  if (options.fit) {
    url.searchParams.set('fit', options.fit);
  }

  url.searchParams.set('format', options.requestedFormat);
  url.searchParams.set('__resolved_format', options.outputFormat);

  return new Request(url.toString(), { method: 'GET' });
}

export function buildProxiedImageUrl(request: Request, originalUrl: string): string {
  const requestUrl = new URL(request.url);
  const encodedOriginalUrl = encodeURIComponent(originalUrl);

  return `${requestUrl.origin}${PROXY_IMAGE_PATH_PREFIX}${encodedOriginalUrl}`;
}

export async function proxySocialImage(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);
  const transformOptions = parseImageTransformOptions(request);
  const cache = (caches as CacheStorage & { default: Cache }).default;
  const cacheKey = buildImageCacheKey(request, transformOptions);
  const cached = await cache.match(cacheKey);

  if (cached) {
    return cached;
  }

  let upstreamImageUrl: URL;

  try {
    const decodedUrl = decodeImageUrlFromPath(requestUrl.pathname);
    upstreamImageUrl = parseAndValidateSocialImageUrl(decodedUrl);
  } catch (error) {
    const details = error instanceof Error ? error.message : 'Invalid image proxy request.';
    const status = details.includes('allowed') ? 403 : 400;

    return json({ error: 'Invalid image proxy URL', details }, status);
  }

  const upstreamResponse = await fetchImageWithFallback(upstreamImageUrl, transformOptions);

  if (!upstreamResponse.ok || upstreamResponse.status >= 400) {
    return json(
      {
        error: 'Failed to fetch proxied image',
        details: `Fallback image request returned HTTP ${upstreamResponse.status}.`,
      },
      502
    );
  }

  const proxiedResponse = buildImageResponse(upstreamResponse, transformOptions);

  await cache.put(cacheKey, proxiedResponse.clone());

  return proxiedResponse;
}

export { proxySocialImage as proxyInstagramImage };
