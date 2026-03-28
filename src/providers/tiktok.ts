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
  description?: string;
  createTime?: number | string;
  createTimeMS?: number | string;
  covers?: string[];
  cover?: string | { urlList?: string[]; url?: string };
  originCover?: string | { urlList?: string[]; url?: string };
  dynamicCover?: string | { urlList?: string[]; url?: string };
  thumbnail?: string;
  shareCover?: string | { urlList?: string[]; url?: string };
  imagePost?: {
    images?: Array<{
      imageURL?: { urlList?: string[] };
    }>;
  };
  video?: {
    cover?: string | { urlList?: string[]; url?: string };
    originCover?: string | { urlList?: string[]; url?: string };
    dynamicCover?: string | { urlList?: string[]; url?: string };
    thumbnail?: string;
    shareCover?: string | { urlList?: string[]; url?: string };
  };
}

interface TikTokScriptData {
  universalData: unknown;
  sigiState: unknown;
  nextData: unknown;
  hasUniversalData: boolean;
  hasSigiState: boolean;
}

interface VideoCandidateDiscovery {
  videos: TikTokVideoNode[];
  candidateKeys: string[];
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

function logExtraction(message: string): void {
  console.log(`[tiktok] ${message}`);
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

function parseUniversalData(bodyText: string): unknown {
  return extractScriptJson<unknown>(bodyText, '__UNIVERSAL_DATA_FOR_REHYDRATION__');
}

function parseSigiState(bodyText: string): unknown {
  return extractScriptJson<unknown>(bodyText, 'SIGI_STATE');
}

function extractTikTokDataScripts(bodyText: string): TikTokScriptData {
  const universalData = parseUniversalData(bodyText);
  const sigiState = parseSigiState(bodyText);

  return {
    universalData,
    sigiState,
    nextData: extractNextDataJson(bodyText),
    hasUniversalData: universalData !== null,
    hasSigiState: sigiState !== null,
  };
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

function readUrlFromCoverLike(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  if (!isRecord(value)) {
    return null;
  }

  if (typeof value.url === 'string' && value.url.length > 0) {
    return value.url;
  }

  const list = value.urlList;
  if (Array.isArray(list)) {
    for (const candidate of list) {
      if (typeof candidate === 'string' && candidate.length > 0) {
        return candidate;
      }
    }
  }

  return null;
}

function firstStringFromUnknownArray(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }

  for (const item of value) {
    if (typeof item === 'string' && item.length > 0) {
      return item;
    }
  }

  return null;
}

function likelyVideoObject(value: unknown): value is TikTokVideoNode {
  if (!isRecord(value)) {
    return false;
  }

  const hasId = typeof value.id === 'string' || typeof value.id === 'number';
  const hasVideoSignals =
    'video' in value ||
    'desc' in value ||
    'description' in value ||
    'createTime' in value ||
    'covers' in value ||
    'cover' in value ||
    'originCover' in value ||
    'dynamicCover' in value ||
    'thumbnail' in value ||
    'shareCover' in value ||
    'stats' in value;

  return hasId && hasVideoSignals;
}

function collectFromItemModule(itemModule: unknown): TikTokVideoNode[] {
  if (!isRecord(itemModule)) {
    return [];
  }

  return Object.values(itemModule).filter(likelyVideoObject);
}

function collectVideosFromArray(items: unknown[]): TikTokVideoNode[] {
  return items.filter(likelyVideoObject);
}

function collectVideosFromIdListAndModule(idList: unknown, itemModule: unknown): TikTokVideoNode[] {
  if (!Array.isArray(idList) || !isRecord(itemModule)) {
    return [];
  }

  const videos: TikTokVideoNode[] = [];

  for (const id of idList) {
    const stringId = typeof id === 'number' ? String(id) : typeof id === 'string' ? id : null;
    if (!stringId) {
      continue;
    }

    const candidate = itemModule[stringId];
    if (likelyVideoObject(candidate)) {
      videos.push(candidate);
    }
  }

  return videos;
}

function findTikTokVideoCandidates(payload: unknown): VideoCandidateDiscovery {
  const candidates: TikTokVideoNode[] = [];
  const candidateKeys = new Set<string>();
  const seenObjects = new Set<object>();

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      const arrayVideos = collectVideosFromArray(node);
      if (arrayVideos.length > 0) {
        candidateKeys.add('embedded-array');
        candidates.push(...arrayVideos);
      }

      for (const item of node) {
        visit(item);
      }
      return;
    }

    if (!isRecord(node)) {
      return;
    }

    if (seenObjects.has(node)) {
      return;
    }
    seenObjects.add(node);

    if (likelyVideoObject(node)) {
      candidateKeys.add('direct-video-node');
      candidates.push(node);
    }

    const itemModule = 'ItemModule' in node ? node.ItemModule : 'itemModule' in node ? node.itemModule : null;
    const itemModuleVideos = collectFromItemModule(itemModule);
    if (itemModuleVideos.length > 0) {
      candidateKeys.add('itemModule');
      candidates.push(...itemModuleVideos);
    }

    const idList =
      (isRecord(node.userPost) && Array.isArray(node.userPost.itemList) ? node.userPost.itemList : null) ??
      (isRecord(node['user-post']) && Array.isArray(node['user-post'].itemList) ? node['user-post'].itemList : null) ??
      (isRecord(node['user-posts']) && Array.isArray(node['user-posts'].itemList)
        ? node['user-posts'].itemList
        : null) ??
      (Array.isArray(node.itemList) ? node.itemList : null);

    if (idList) {
      candidateKeys.add('itemList');
      const videosById = collectVideosFromIdListAndModule(idList, itemModule);
      if (videosById.length > 0) {
        candidateKeys.add('itemList->itemModule');
        candidates.push(...videosById);
      }
    }

    for (const [key, value] of Object.entries(node)) {
      if (
        key === 'ItemModule' ||
        key === 'itemModule' ||
        key === 'itemList' ||
        key === 'userPost' ||
        key === 'user-post' ||
        key === 'user-posts'
      ) {
        candidateKeys.add(key);
      }
      visit(value);
    }
  };

  visit(payload);

  return {
    videos: candidates,
    candidateKeys: Array.from(candidateKeys).sort(),
  };
}

function normalizeTikTokVideo(video: TikTokVideoNode, username: string): SocialPost {
  const rawId = video.id;
  const id = typeof rawId === 'number' ? String(rawId) : typeof rawId === 'string' && rawId.length > 0 ? rawId : null;
  const caption = video.desc ?? video.description ?? '';

  const thumbnail =
    readUrlFromCoverLike(video.video?.cover) ??
    readUrlFromCoverLike(video.video?.originCover) ??
    readUrlFromCoverLike(video.cover) ??
    readUrlFromCoverLike(video.originCover) ??
    readUrlFromCoverLike(video.thumbnail ?? video.video?.thumbnail) ??
    readUrlFromCoverLike(video.shareCover ?? video.video?.shareCover) ??
    readUrlFromCoverLike(video.video?.dynamicCover) ??
    readUrlFromCoverLike(video.dynamicCover) ??
    firstStringFromUnknownArray(video.covers) ??
    video.imagePost?.images?.[0]?.imageURL?.urlList?.[0] ??
    null;

  return {
    id,
    shortcode: id,
    caption,
    thumbnail_url: thumbnail,
    post_url: id ? `https://www.tiktok.com/@${username}/video/${id}` : null,
    timestamp: normalizeTimestamp(video.createTime ?? video.createTimeMS),
  };
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

function extractTikTokData(bodyText: string, usernameForUrls: string): { profile: TikTokProfileMeta; posts: SocialPost[] } {
  const scripts = extractTikTokDataScripts(bodyText);

  logExtraction(
    `data scripts found universal=${String(scripts.hasUniversalData)} sigi=${String(scripts.hasSigiState)} next=${String(
      scripts.nextData !== null
    )}`
  );

  const profile = mergeProfile(
    extractProfileMetaFromStructuredData(scripts.universalData) ??
      extractProfileMetaFromStructuredData(scripts.sigiState) ??
      extractProfileMetaFromStructuredData(scripts.nextData),
    extractProfileMetaWithRegex(bodyText)
  );

  const universalCandidates = findTikTokVideoCandidates(scripts.universalData);
  const sigiCandidates = findTikTokVideoCandidates(scripts.sigiState);
  const nextCandidates = findTikTokVideoCandidates(scripts.nextData);

  logExtraction(
    `candidate modules universal=[${universalCandidates.candidateKeys.join(',')}] sigi=[${sigiCandidates.candidateKeys.join(
      ','
    )}] next=[${nextCandidates.candidateKeys.join(',')}]`
  );

  const normalizedCandidates = [
    ...universalCandidates.videos.map((video) => normalizeTikTokVideo(video, usernameForUrls)),
    ...sigiCandidates.videos.map((video) => normalizeTikTokVideo(video, usernameForUrls)),
    ...nextCandidates.videos.map((video) => normalizeTikTokVideo(video, usernameForUrls)),
  ];

  const regexCandidates = extractPostsWithRegex(bodyText);

  logExtraction(
    `candidate counts universal=${universalCandidates.videos.length} sigi=${sigiCandidates.videos.length} next=${nextCandidates.videos.length} regex=${regexCandidates.length}`
  );

  const posts = dedupePosts([...normalizedCandidates, ...regexCandidates]);

  if ((profile.videos ?? 0) > 0 && posts.length === 0) {
    logExtraction('profile reports videos>0 but post extraction returned 0 candidates');
  }

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
  const extracted = extractTikTokData(upstream.bodyText, username);

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
  const extracted = extractTikTokData(upstream.bodyText, username);

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
