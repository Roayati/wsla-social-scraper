import type {
  SocialPost,
  SocialProvider,
  TikTokProfileMeta,
  TikTokProfileResponse,
} from '../types/social';
import { badRequest, internalError } from '../utils/errors';
import { buildProxiedImageUrl } from '../utils/image-proxy';

interface TikTokUpstreamResponse {
  bodyText: string;
  contentType: string;
  status: number;
}

interface TikTokVideoNode {
  id?: string | number;
  desc?: string;
  createTime?: number | string;
  createTimeMS?: number | string;
  covers?: string[];
  imagePost?: {
    images?: Array<{
      imageURL?: { urlList?: string[] };
    }>;
  };
  video?: {
    cover?: string;
    originCover?: string;
    dynamicCover?: string;
  };
}

const TIKTOK_PROFILE_URL = 'https://www.tiktok.com/@';
const RESPONSE_LOG_PREVIEW_LENGTH = 500;

function createEmptyTikTokProfileMeta(): TikTokProfileMeta {
  return {
    followers: null,
    following: null,
    likes: null,
    videos: null,
  };
}

function buildHeaders(): HeadersInit {
  return {
    'User-Agent':
      'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    Referer: 'https://www.tiktok.com/',
  };
}

function getBodyPreview(bodyText: string): string {
  return bodyText.slice(0, RESPONSE_LOG_PREVIEW_LENGTH).replace(/\s+/g, ' ').trim();
}

function logUpstreamResponse(status: number, bodyText: string): void {
  console.log(`[tiktok] upstream HTTP status: ${status}`);
  console.log(`[tiktok] upstream response preview: ${getBodyPreview(bodyText)}`);
}

function isHtmlResponse(contentType: string, bodyText: string): boolean {
  const normalizedBody = bodyText.trimStart().toLowerCase();

  return (
    contentType.toLowerCase().includes('text/html') ||
    normalizedBody.startsWith('<!doctype html') ||
    normalizedBody.startsWith('<html')
  );
}

async function fetchTikTokProfile(username: string): Promise<TikTokUpstreamResponse> {
  const response = await fetch(`${TIKTOK_PROFILE_URL}${encodeURIComponent(username)}`, {
    method: 'GET',
    headers: buildHeaders(),
    redirect: 'follow',
  });
  const contentType = response.headers.get('content-type') ?? '';
  const bodyText = await response.text();

  logUpstreamResponse(response.status, bodyText);

  if (response.status === 404) {
    throw badRequest('TikTok profile not found', `No public TikTok profile was found for '${username}'.`);
  }

  if (!response.ok) {
    throw internalError(
      'Scraper request failed',
      `TikTok returned HTTP ${response.status}. Response preview: ${getBodyPreview(bodyText)}`
    );
  }

  if (!isHtmlResponse(contentType, bodyText)) {
    throw internalError('Scraper request failed', 'TikTok returned a non-HTML response while loading the profile page.');
  }

  return {
    status: response.status,
    contentType,
    bodyText,
  };
}

function tryParseJson<T>(rawValue: string): T | null {
  try {
    return JSON.parse(rawValue) as T;
  } catch {
    return null;
  }
}

function extractScriptJson<T>(bodyText: string, id: string): T | null {
  const pattern = new RegExp(`<script[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/script>`, 'i');
  const match = pattern.exec(bodyText);

  if (!match?.[1]) {
    return null;
  }

  const rawJson = match[1].trim();

  return tryParseJson<T>(rawJson);
}

function extractNextDataJson(bodyText: string): unknown {
  return extractScriptJson<unknown>(bodyText, '__NEXT_DATA__');
}

function extractUniversalDataJson(bodyText: string): unknown {
  return extractScriptJson<unknown>(bodyText, '__UNIVERSAL_DATA_FOR_REHYDRATION__');
}

function extractSigiStateJson(bodyText: string): unknown {
  return extractScriptJson<unknown>(bodyText, 'SIGI_STATE');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
  }

  if (typeof value === 'string') {
    const numeric = Number.parseInt(value, 10);

    if (!Number.isFinite(numeric)) {
      return null;
    }

    return numeric > 1_000_000_000_000 ? Math.floor(numeric / 1000) : numeric;
  }

  return null;
}

function findFirstObjectWithKeys(value: unknown, keys: string[]): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstObjectWithKeys(item, keys);
      if (found) {
        return found;
      }
    }

    return null;
  }

  if (!isRecord(value)) {
    return null;
  }

  if (keys.every((key) => key in value)) {
    return value;
  }

  for (const nestedValue of Object.values(value)) {
    const found = findFirstObjectWithKeys(nestedValue, keys);
    if (found) {
      return found;
    }
  }

  return null;
}

function extractProfileMetaFromStructuredData(payload: unknown): TikTokProfileMeta | null {
  const stats = findFirstObjectWithKeys(payload, ['followerCount', 'followingCount', 'heartCount', 'videoCount']);

  if (!stats) {
    return null;
  }

  return {
    followers: toFiniteNumber(stats.followerCount),
    following: toFiniteNumber(stats.followingCount),
    likes: toFiniteNumber(stats.heartCount),
    videos: toFiniteNumber(stats.videoCount),
  };
}

function extractFromItemModule(itemModule: unknown): SocialPost[] {
  if (!isRecord(itemModule)) {
    return [];
  }

  return Object.values(itemModule)
    .map((item) => item as TikTokVideoNode)
    .filter((item) => item?.id)
    .map((item) => {
      const id = String(item.id ?? '');
      const thumbnail =
        item.video?.cover ??
        item.video?.originCover ??
        item.video?.dynamicCover ??
        item.covers?.[0] ??
        item.imagePost?.images?.[0]?.imageURL?.urlList?.[0] ??
        null;

      return {
        id: id || null,
        shortcode: id || null,
        caption: item.desc ?? '',
        thumbnail_url: thumbnail,
        post_url: id ? '' : null,
        timestamp: normalizeTimestamp(item.createTime ?? item.createTimeMS),
      } satisfies SocialPost;
    });
}

function extractPostCandidatesFromStructuredData(payload: unknown): SocialPost[] {
  if (!payload) {
    return [];
  }

  const itemModuleContainer = findFirstObjectWithKeys(payload, ['itemModule']);

  if (itemModuleContainer && 'itemModule' in itemModuleContainer) {
    return extractFromItemModule(itemModuleContainer.itemModule);
  }

  const itemModuleDirect = findFirstObjectWithKeys(payload, ['ItemModule']);

  if (itemModuleDirect && 'ItemModule' in itemModuleDirect) {
    return extractFromItemModule(itemModuleDirect.ItemModule);
  }

  return [];
}

function dedupePosts(posts: SocialPost[]): SocialPost[] {
  const seenIds = new Set<string>();
  const result: SocialPost[] = [];

  for (const post of posts) {
    const key = post.id ?? post.shortcode ?? '';

    if (!key || seenIds.has(key)) {
      continue;
    }

    seenIds.add(key);
    result.push(post);
  }

  return result;
}

function extractProfileMetaWithRegex(bodyText: string): TikTokProfileMeta {
  const parse = (pattern: RegExp): number | null => {
    const match = pattern.exec(bodyText);

    if (!match?.[1]) {
      return null;
    }

    return toFiniteNumber(match[1]);
  };

  return {
    followers: parse(/"followerCount"\s*:\s*(\d+)/),
    following: parse(/"followingCount"\s*:\s*(\d+)/),
    likes: parse(/"heartCount"\s*:\s*(\d+)/),
    videos: parse(/"videoCount"\s*:\s*(\d+)/),
  };
}

function extractPostsWithRegex(bodyText: string): SocialPost[] {
  const posts: SocialPost[] = [];
  const itemPattern = /"id"\s*:\s*"(\d{8,})"[\s\S]{0,800}?"desc"\s*:\s*"([^"]*)"[\s\S]{0,800}?"createTime"\s*:\s*(\d+)/g;

  let match: RegExpExecArray | null;

  while ((match = itemPattern.exec(bodyText)) !== null) {
    posts.push({
      id: match[1] ?? null,
      shortcode: match[1] ?? null,
      caption: match[2] ?? '',
      thumbnail_url: null,
      post_url: null,
      timestamp: normalizeTimestamp(match[3]),
    });
  }

  return posts;
}

function mergeProfile(primary: TikTokProfileMeta | null, fallback: TikTokProfileMeta): TikTokProfileMeta {
  return {
    followers: primary?.followers ?? fallback.followers,
    following: primary?.following ?? fallback.following,
    likes: primary?.likes ?? fallback.likes,
    videos: primary?.videos ?? fallback.videos,
  };
}

function withPostUrlsAndProxy(
  request: Request,
  username: string,
  posts: SocialPost[],
  limit: number
): SocialPost[] {
  return posts.slice(0, limit).map((post) => {
    const id = post.id ?? post.shortcode;

    return {
      ...post,
      id,
      shortcode: post.shortcode ?? id,
      caption: post.caption ?? '',
      thumbnail_url: post.thumbnail_url ? buildProxiedImageUrl(request, post.thumbnail_url) : null,
      post_url: id ? `https://www.tiktok.com/@${username}/video/${id}` : post.post_url,
    };
  });
}

function extractTikTokData(bodyText: string): { profile: TikTokProfileMeta; posts: SocialPost[] } {
  const universalData = extractUniversalDataJson(bodyText);
  const sigiState = extractSigiStateJson(bodyText);
  const nextData = extractNextDataJson(bodyText);

  const profile = mergeProfile(
    extractProfileMetaFromStructuredData(universalData) ??
      extractProfileMetaFromStructuredData(sigiState) ??
      extractProfileMetaFromStructuredData(nextData),
    extractProfileMetaWithRegex(bodyText)
  );

  const posts = dedupePosts([
    ...extractPostCandidatesFromStructuredData(universalData),
    ...extractPostCandidatesFromStructuredData(sigiState),
    ...extractPostCandidatesFromStructuredData(nextData),
    ...extractPostsWithRegex(bodyText),
  ]);

  return {
    profile,
    posts,
  };
}

function hasAnyProfileValue(profile: TikTokProfileMeta): boolean {
  return Object.values(profile).some((value) => value !== null);
}

export async function getTikTokProfile(username: string, limit: number, request: Request): Promise<TikTokProfileResponse> {
  const upstream = await fetchTikTokProfile(username);
  const extracted = extractTikTokData(upstream.bodyText);

  if (!hasAnyProfileValue(extracted.profile) && extracted.posts.length === 0) {
    throw internalError(
      'Scraper request failed',
      'TikTok returned a profile page but no supported data blobs were parsed. The page may be blocked or format changed.'
    );
  }

  return {
    profile: hasAnyProfileValue(extracted.profile) ? extracted.profile : createEmptyTikTokProfileMeta(),
    posts: withPostUrlsAndProxy(request, username, extracted.posts, limit),
  };
}

export async function getTikTokPosts(username: string, limit: number): Promise<SocialPost[]> {
  const upstream = await fetchTikTokProfile(username);
  const extracted = extractTikTokData(upstream.bodyText);

  return extracted.posts.slice(0, limit).map((post) => {
    const id = post.id ?? post.shortcode;

    return {
      ...post,
      id,
      shortcode: post.shortcode ?? id,
      caption: post.caption ?? '',
      post_url: id ? `https://www.tiktok.com/@${username}/video/${id}` : post.post_url,
    };
  });
}

export const tiktokProvider: SocialProvider = {
  platform: 'tiktok',
  getPosts: getTikTokPosts,
};

export { createEmptyTikTokProfileMeta };
