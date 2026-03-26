import { createEmptyProfileMeta, getInstagramProfile } from './providers/instagram';
import type { InstagramProfileResponse, SocialFeedResponse } from './types/social';
import { AppError, notFound, toAppError, unauthorized } from './utils/errors';
import { buildProxiedImageUrl, proxyInstagramImage } from './utils/image-proxy';
import { errorResponse, json, optionsResponse, withCacheHeaders } from './utils/json';
import { normalizeLimit, normalizeUsername } from './utils/validation';

export interface Env {
  API_KEY?: string;
}

function isAuthorized(request: Request, env: Env): boolean {
  if (!env.API_KEY) {
    return true;
  }

  return request.headers.get('x-api-key') === env.API_KEY;
}

function buildInstagramResponse(
  request: Request,
  username: string,
  result: InstagramProfileResponse
): SocialFeedResponse {
  return {
    platform: 'instagram',
    username,
    count: result.posts.length,
    profile: result.profile ?? createEmptyProfileMeta(),
    posts: result.posts.map((post) => ({
      ...post,
      thumbnail_url: post.thumbnail_url ? buildProxiedImageUrl(request, post.thumbnail_url) : null,
    })),
  };
}

async function handleHealth(): Promise<Response> {
  return json({
    ok: true,
    service: 'wsla-social-scraper',
  });
}

async function handleInstagram(request: Request, ctx: ExecutionContext): Promise<Response> {
  const cache = (caches as CacheStorage & { default: Cache }).default;
  const cacheKey = new Request(request.url, { method: 'GET' });
  const cached = await cache.match(cacheKey);

  if (cached) {
    return withCacheHeaders(cached);
  }

  const url = new URL(request.url);
  const username = normalizeUsername(url.searchParams.get('username'));
  const limit = normalizeLimit(url.searchParams.get('limit'));
  const result = await getInstagramProfile(username, limit);
  const response = withCacheHeaders(json(buildInstagramResponse(request, username, result)));

  ctx.waitUntil(cache.put(cacheKey, response.clone()));

  return response;
}

async function routeRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return optionsResponse();
  }

  const url = new URL(request.url);

  if (request.method !== 'GET') {
    throw notFound('Route not found', `No handler exists for ${request.method} ${url.pathname}.`);
  }

  if (url.pathname === '/image' || url.pathname.startsWith('/image/')) {
    return proxyInstagramImage(request);
  }

  if (!isAuthorized(request, env)) {
    throw unauthorized('Invalid API key', 'Provide a valid x-api-key header.');
  }

  if (url.pathname === '/health') {
    return handleHealth();
  }

  if (url.pathname === '/instagram') {
    return handleInstagram(request, ctx);
  }

  throw notFound('Route not found', `No handler exists for ${url.pathname}.`);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await routeRequest(request, env, ctx);
    } catch (error) {
      return errorResponse(toAppError(error));
    }
  },
};

export { AppError };
