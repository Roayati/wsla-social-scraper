import type { SocialPost, SocialProvider } from '../types/social';
import { badRequest, internalError } from '../utils/errors';

const INSTAGRAM_APP_ID = '936619743392459';
const INSTAGRAM_API_URL = 'https://www.instagram.com/api/v1/users/web_profile_info/';
const USER_AGENTS = [
  'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Mobile Safari/537.36 Instagram 269.0.0.18.75',
  'Mozilla/5.0 (Linux; Android 12; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.104 Mobile Safari/537.36 Instagram 216.1.0.21.137',
  'Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/97.0.4692.87 Mobile Safari/537.36 Instagram 217.0.0.27.359',
];

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

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)] ?? USER_AGENTS[0];
}

function buildHeaders(): HeadersInit {
  return {
    'User-Agent': getRandomUserAgent(),
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    Referer: 'https://www.instagram.com/',
    Origin: 'https://www.instagram.com',
    'X-IG-App-ID': INSTAGRAM_APP_ID,
    'X-ASBD-ID': '198387',
    'X-IG-WWW-Claim': '0',
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

async function fetchInstagramProfile(username: string): Promise<InstagramApiResponse> {
  const url = new URL(INSTAGRAM_API_URL);
  url.searchParams.set('username', username);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: buildHeaders(),
    redirect: 'follow',
  });

  if (response.status === 404) {
    throw badRequest('Instagram profile not found', `No public Instagram profile was found for '${username}'.`);
  }

  if (response.status === 401 || response.status === 403) {
    throw internalError('Scraper request failed', 'Instagram rejected the upstream request.');
  }

  if (!response.ok) {
    throw internalError('Scraper request failed', `Instagram returned HTTP ${response.status}.`);
  }

  let payload: InstagramApiResponse;

  try {
    payload = (await response.json()) as InstagramApiResponse;
  } catch (error) {
    throw internalError(
      'Scraper request failed',
      error instanceof Error ? `Failed to parse Instagram response: ${error.message}` : 'Failed to parse Instagram response.'
    );
  }

  return payload;
}

export async function getInstagramPosts(username: string, limit = 5): Promise<SocialPost[]> {
  const payload = await fetchInstagramProfile(username);
  const edges = payload.data?.user?.edge_owner_to_timeline_media?.edges;

  if (payload.data?.user === null) {
    throw badRequest('Instagram profile not found', `No public Instagram profile was found for '${username}'.`);
  }

  if (!Array.isArray(edges)) {
    throw internalError('Scraper request failed', 'Instagram returned an unexpected payload shape.');
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
