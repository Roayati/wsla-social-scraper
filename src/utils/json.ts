import { AppError } from './errors';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, x-api-key',
};

function buildHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init);

  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    headers.set(key, value);
  });

  return headers;
}

export function jsonResponse(data: unknown, status = 200, init?: HeadersInit): Response {
  const headers = buildHeaders(init);
  headers.set('content-type', 'application/json; charset=utf-8');

  return new Response(JSON.stringify(data), {
    status,
    headers,
  });
}

export function errorResponse(error: AppError): Response {
  const payload: { error: string; details?: string } = {
    error: error.message,
  };

  if (error.details) {
    payload.details = error.details;
  }

  return jsonResponse(payload, error.status);
}

export function optionsResponse(): Response {
  const headers = buildHeaders();
  headers.set('content-length', '0');
  return new Response(null, { status: 204, headers });
}

export function withCacheHeaders(response: Response, cacheControl = 'public, max-age=300'): Response {
  const headers = buildHeaders(response.headers);
  headers.set('Cache-Control', cacheControl);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
