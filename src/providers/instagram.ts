import type { SocialPost, SocialProvider } from '../types/social';
import { badRequest, internalError } from '../utils/errors';

const INSTAGRAM_APP_ID = '936619743392459';
const INSTAGRAM_API_URL = 'https://www.instagram.com/api/v1/users/web_profile_info/';
const MOBILE_BROWSER_PROFILES = [
  {
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36',
    secChUa:
      '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
    secChUaPlatform: '"Android"',
    secChUaMobile: '?1',
  },
  {
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36',
    secChUa:
      '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
    secChUaPlatform: '"Android"',
    secChUaMobile: '?1',
  },
];
const RESPONSE_LOG_PREVIEW_LENGTH = 500;

interface InstagramCaptionEdge {
  node?: {
    text?: string;
  };
}

interface InstagramNode {
  id?: string;
  shortcode?: string;
  taken_at_timestamp?: number;
  display_url?: string;
  thumbnail_src?: string;
  edge_media_to_caption?: {
    edges?: InstagramCaptionEdge[];
  };
}

interface InstagramApiResponse {
  data?: {
    user?: {
      edge_owner_to_timeline_media?: {
        edges?: Array<{
          node?: InstagramNode;
        }>;
      };
    } | null;
  };
  status?: string;
}

interface InstagramUpstreamResponse {
  contentType: string;
  status: number;
  bodyText: string;
}

function getRandomMobileBrowserProfile() {
  return (
    MOBILE_BROWSER_PROFILES[Math.floor(Math.random() * MOBILE_BROWSER_PROFILES.length)] ?? MOBILE_BROWSER_PROFILES[0]
  );
}

function buildHeaders(): HeadersInit {
  const profile = getRandomMobileBrowserProfile();

  return {
    'User-Agent': profile.userAgent,
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    Referer: 'https://www.instagram.com/',
    Origin: 'https://www.instagram.com',
    DNT: '1',
    Priority: 'u=1, i',
    'Sec-CH-UA': profile.secChUa,
    'Sec-CH-UA-Mobile': profile.secChUaMobile,
    'Sec-CH-UA-Platform': profile.secChUaPlatform,
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'Upgrade-Insecure-Requests': '1',
    'X-IG-App-ID': INSTAGRAM_APP_ID,
    'X-ASBD-ID': '198387',
    'X-IG-WWW-Claim': '0',
    'X-Requested-With': 'XMLHttpRequest',
  };
}

function mapNodeToPost(node: InstagramNode): SocialPost {
  const shortcode = node.shortcode ?? null;

  return {
    id: node.id ?? null,
    shortcode,
    caption: node.edge_media_to_caption?.edges?.[0]?.node?.text ?? '',
    thumbnail_url: node.display_url ?? node.thumbnail_src ?? null,
    post_url: shortcode ? `https://www.instagram.com/p/${shortcode}/` : null,
    timestamp: node.taken_at_timestamp ?? null,
  };
}

function getBodyPreview(bodyText: string): string {
  return bodyText.slice(0, RESPONSE_LOG_PREVIEW_LENGTH).replace(/\s+/g, ' ').trim();
}

function logUpstreamResponse(status: number, bodyText: string): void {
  console.log(`[instagram] upstream HTTP status: ${status}`);
  console.log(`[instagram] upstream response preview: ${getBodyPreview(bodyText)}`);
}

function isHtmlResponse(contentType: string, bodyText: string): boolean {
  const normalizedBody = bodyText.trimStart().toLowerCase();

  return (
    contentType.toLowerCase().includes('text/html') ||
    normalizedBody.startsWith('<!doctype html') ||
    normalizedBody.startsWith('<html')
  );
}

function buildUpstreamError(status: number, bodyText: string, contentType: string): Error {
  const preview = getBodyPreview(bodyText);
  const previewSuffix = preview ? ` Response preview: ${preview}` : '';

  if (status === 403) {
    return internalError(
      'Scraper request failed',
      `Instagram blocked the upstream request with HTTP 403. This usually means the current request fingerprint was challenged or denied.${previewSuffix}`
    );
  }

  if (status === 429) {
    return internalError(
      'Scraper request failed',
      `Instagram rate-limited the upstream request with HTTP 429. Retry later or reduce request frequency.${previewSuffix}`
    );
  }

  if (isHtmlResponse(contentType, bodyText)) {
    return internalError(
      'Scraper request failed',
      `Instagram returned HTML instead of JSON (content-type: ${contentType || 'unknown'}). This usually indicates an upstream challenge, redirect, or temporary anti-bot page.${previewSuffix}`
    );
  }

  return internalError('Scraper request failed', `Instagram returned HTTP ${status}.${previewSuffix}`);
}

async function fetchInstagramProfile(username: string): Promise<InstagramUpstreamResponse> {
  const url = new URL(INSTAGRAM_API_URL);
  url.searchParams.set('username', username);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: buildHeaders(),
    redirect: 'follow',
  });
  const contentType = response.headers.get('content-type') ?? '';
  const bodyText = await response.text();

  logUpstreamResponse(response.status, bodyText);

  if (response.status === 404) {
    throw badRequest('Instagram profile not found', `No public Instagram profile was found for '${username}'.`);
  }

  if (!response.ok) {
    throw buildUpstreamError(response.status, bodyText, contentType);
  }

  if (isHtmlResponse(contentType, bodyText)) {
    throw buildUpstreamError(response.status, bodyText, contentType);
  }

  return {
    contentType,
    status: response.status,
    bodyText,
  };
}

export async function getInstagramPosts(username: string, limit = 5): Promise<SocialPost[]> {
  const upstream = await fetchInstagramProfile(username);
  let payload: InstagramApiResponse;

  try {
    payload = JSON.parse(upstream.bodyText) as InstagramApiResponse;
  } catch (error) {
    throw internalError(
      'Scraper request failed',
      error instanceof Error
        ? `Failed to parse Instagram JSON response: ${error.message}.`
        : 'Failed to parse Instagram JSON response.'
    );
  }
  const edges = payload.data?.user?.edge_owner_to_timeline_media?.edges;

  if (payload.data?.user === null) {
    throw badRequest('Instagram profile not found', `No public Instagram profile was found for '${username}'.`);
  }

  if (!Array.isArray(edges)) {
    throw internalError(
      'Scraper request failed',
      'Instagram returned an unexpected payload shape while reading timeline media edges.'
    );
  }

  return edges
    .slice(0, limit)
    .map((edge) => edge.node)
    .filter((node): node is InstagramNode => Boolean(node))
    .map(mapNodeToPost);
}

export const instagramProvider: SocialProvider = {
  platform: 'instagram',
  getPosts: getInstagramPosts,
};
