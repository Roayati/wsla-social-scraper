import { AppError } from './errors';

const DEFAULT_CACHE_CONTROL = 'public, max-age=300';
const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type, x-api-key',
};

function applyCorsHeaders(headers: Headers): Headers {
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    headers.set(key, value);
  });

  return headers;
}

function buildJsonHeaders(init?: HeadersInit, cacheControl = DEFAULT_CACHE_CONTROL): Headers {
  const headers = applyCorsHeaders(new Headers(init));
  headers.set('content-type', JSON_CONTENT_TYPE);
  headers.set('cache-control', cacheControl);
  return headers;
}

export function json(data: unknown, status = 200, init?: HeadersInit): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: buildJsonHeaders(init),
  });
}

export function errorResponse(error: AppError): Response {
  const payload: { error: string; details?: string } = {
    error: error.message,
  };

  if (error.details) {
    payload.details = error.details;
  }

  return json(payload, error.status);
}

export function optionsResponse(): Response {
  const headers = applyCorsHeaders(new Headers());
  headers.set('cache-control', DEFAULT_CACHE_CONTROL);
  headers.set('content-length', '0');
  return new Response(null, { status: 204, headers });
}

export function withCacheHeaders(response: Response, cacheControl = DEFAULT_CACHE_CONTROL): Response {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: buildJsonHeaders(response.headers, cacheControl),
  });
}
