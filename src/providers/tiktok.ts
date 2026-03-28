import type {
  SocialPost,
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
  shareUrl?: string;
  covers?: string[];
  cover?: string | { urlList?: string[]; url?: string };
  originCover?: string | { urlList?: string[]; url?: string };
  dynamicCover?: string | { urlList?: string[]; url?: string };
  thumbnail?: string;
  shareCover?: string | { urlList?: string[]; url?: string };
  author?: {
    uniqueId?: string;
    nickname?: string;
  };
  authorInfo?: {
    uniqueId?: string;
    nickname?: string;
  };
  imagePost?: {
    images?: Array<{
      imageURL?: { urlList?: string[] };
      imageUrl?: { urlList?: string[] };
      displayImage?: { urlList?: string[] };
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

interface TikTokDataExtraction {
  profile: TikTokProfileMeta;
  posts: SocialPost[];
}

interface PostExtractionResult {
  posts: SocialPost[];
  postIdsCount: number;
  itemModuleCount: number;
  joinedItemsCount: number;
  normalizedCount: number;
  source: string;
}

const TIKTOK_PROFILE_URL = 'https://www.tiktok.com/@';
const RESPONSE_LOG_PREVIEW_LENGTH = 500;

export function createEmptyTikTokProfileMeta(): TikTokProfileMeta {
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

function extractTikTokScripts(bodyText: string): TikTokScriptData {
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

function asTikTokId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  return null;
}

function normalizeUsername(value: string): string {
  return value.trim().replace(/^@+/, '').toLowerCase();
}

function usernamesMatch(a: string | null, b: string): boolean {
  if (!a) {
    return false;
  }

  return normalizeUsername(a) === normalizeUsername(b);
}

function getAuthorUniqueId(item: unknown): string | null {
  if (!isRecord(item)) {
    return null;
  }

  const author = isRecord(item.author) ? item.author : null;
  const authorInfo = isRecord(item.authorInfo) ? item.authorInfo : null;

  if (typeof author?.uniqueId === 'string' && author.uniqueId.length > 0) {
    return author.uniqueId;
  }

  if (typeof authorInfo?.uniqueId === 'string' && authorInfo.uniqueId.length > 0) {
    return authorInfo.uniqueId;
  }

  return null;
}

function pickBestTikTokCover(item: TikTokVideoNode): string | null {
  const imagePostCover =
    item.imagePost?.images?.[0]?.imageURL?.urlList?.[0] ??
    item.imagePost?.images?.[0]?.imageUrl?.urlList?.[0] ??
    item.imagePost?.images?.[0]?.displayImage?.urlList?.[0] ??
    null;

  return (
    readUrlFromCoverLike(item.video?.cover) ??
    readUrlFromCoverLike(item.video?.originCover) ??
    readUrlFromCoverLike(item.video?.dynamicCover) ??
    readUrlFromCoverLike(item.cover) ??
    readUrlFromCoverLike(item.originCover) ??
    readUrlFromCoverLike(item.dynamicCover) ??
    firstStringFromUnknownArray(item.covers) ??
    readUrlFromCoverLike(item.thumbnail ?? item.video?.thumbnail) ??
    readUrlFromCoverLike(item.shareCover ?? item.video?.shareCover) ??
    imagePostCover
  );
}

function pickCanonicalTikTokUrl(item: TikTokVideoNode, username: string): string | null {
  if (typeof item.shareUrl === 'string' && item.shareUrl.length > 0) {
    return item.shareUrl;
  }

  const id = asTikTokId(item.id);
  if (!id) {
    return null;
  }

  return `https://www.tiktok.com/@${username}/video/${id}`;
}

function getTikTokItemModule(payload: unknown): Record<string, unknown> {
  const seen = new Set<object>();

  const visit = (node: unknown): Record<string, unknown> | null => {
    if (!isRecord(node)) {
      if (Array.isArray(node)) {
        for (const entry of node) {
          const found = visit(entry);
          if (found) {
            return found;
          }
        }
      }
      return null;
    }

    if (seen.has(node)) {
      return null;
    }
    seen.add(node);

    const directItemModule = isRecord(node.ItemModule) ? node.ItemModule : isRecord(node.itemModule) ? node.itemModule : null;
    if (directItemModule) {
      return directItemModule;
    }

    for (const value of Object.values(node)) {
      const found = visit(value);
      if (found) {
        return found;
      }
    }

    return null;
  };

  return visit(payload) ?? {};
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const ids: string[] = [];
  for (const entry of value) {
    const id = asTikTokId(entry);
    if (id) {
      ids.push(id);
    }
  }

  return ids;
}

function getTikTokUserPostIds(payload: unknown): string[] {
  const candidates: string[][] = [];
  const seen = new Set<object>();

  const addCandidate = (value: unknown): void => {
    const ids = readStringArray(value);
    if (ids.length > 0) {
      candidates.push(ids);
    }
  };

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const entry of node) {
        visit(entry);
      }
      return;
    }

    if (!isRecord(node)) {
      return;
    }

    if (seen.has(node)) {
      return;
    }
    seen.add(node);

    addCandidate(node.itemList);
    addCandidate(node.postList);

    if (isRecord(node.userPost)) {
      addCandidate(node.userPost.itemList);
      addCandidate(node.userPost.postList);
    }

    if (isRecord(node['user-post'])) {
      addCandidate(node['user-post'].itemList);
      addCandidate(node['user-post'].postList);
    }

    if (isRecord(node['user-posts'])) {
      addCandidate(node['user-posts'].itemList);
      addCandidate(node['user-posts'].postList);
    }

    for (const [key, value] of Object.entries(node)) {
      if (key.toLowerCase().includes('itemlist') || key.toLowerCase().includes('postlist')) {
        addCandidate(value);
      }
      visit(value);
    }
  };

  visit(payload);

  candidates.sort((a, b) => b.length - a.length);

  return candidates[0] ?? [];
}

function normalizeTikTokVideo(item: TikTokVideoNode, username: string, request: Request): SocialPost | null {
  const id = asTikTokId(item.id);

  if (!id) {
    return null;
  }

  const cover = pickBestTikTokCover(item);
  if (!cover) {
    return null;
  }

  const postUrl = pickCanonicalTikTokUrl(item, username);
  if (!postUrl) {
    return null;
  }

  return {
    id,
    shortcode: id,
    caption: item.desc ?? item.description ?? '',
    thumbnail_url: buildProxiedImageUrl(request, cover),
    post_url: postUrl,
    timestamp: normalizeTimestamp(item.createTime ?? item.createTimeMS),
  };
}

function isLikelyVideoItem(item: unknown): item is TikTokVideoNode {
  if (!isRecord(item)) {
    return false;
  }

  return asTikTokId(item.id) !== null && ('video' in item || 'createTime' in item || 'desc' in item || 'shareUrl' in item);
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

function mergeProfile(primary: TikTokProfileMeta | null, fallback: TikTokProfileMeta): TikTokProfileMeta {
  return {
    followers: primary?.followers ?? fallback.followers,
    following: primary?.following ?? fallback.following,
    likes: primary?.likes ?? fallback.likes,
    videos: primary?.videos ?? fallback.videos,
  };
}

function sortPostsNewestFirst(posts: SocialPost[]): SocialPost[] {
  return [...posts].sort((a, b) => {
    const aTs = a.timestamp ?? 0;
    const bTs = b.timestamp ?? 0;

    if (aTs !== bTs) {
      return bTs - aTs;
    }

    return (b.id ?? '').localeCompare(a.id ?? '');
  });
}

function extractPostsFromPayload(payload: unknown, username: string, request: Request, source: string): PostExtractionResult {
  const itemModule = getTikTokItemModule(payload);
  const postIds = getTikTokUserPostIds(payload);

  const joinedItems: TikTokVideoNode[] = [];
  for (const id of postIds) {
    const candidate = itemModule[id];
    if (isLikelyVideoItem(candidate)) {
      joinedItems.push(candidate);
    }
  }

  const normalizedFromJoin = joinedItems
    .map((item) => normalizeTikTokVideo(item, username, request))
    .filter((post): post is SocialPost => post !== null);

  if (normalizedFromJoin.length > 0) {
    return {
      posts: dedupePosts(sortPostsNewestFirst(normalizedFromJoin)),
      postIdsCount: postIds.length,
      itemModuleCount: Object.keys(itemModule).length,
      joinedItemsCount: joinedItems.length,
      normalizedCount: normalizedFromJoin.length,
      source,
    };
  }

  const fallbackItems = Object.values(itemModule).filter((item) => {
    if (!isLikelyVideoItem(item)) {
      return false;
    }

    const authorUniqueId = getAuthorUniqueId(item);
    if (authorUniqueId && !usernamesMatch(authorUniqueId, username)) {
      return false;
    }

    const typed = item as TikTokVideoNode;
    return pickBestTikTokCover(typed) !== null && pickCanonicalTikTokUrl(typed, username) !== null;
  }) as TikTokVideoNode[];

  const normalizedFallback = fallbackItems
    .map((item) => normalizeTikTokVideo(item, username, request))
    .filter((post): post is SocialPost => post !== null);

  return {
    posts: dedupePosts(sortPostsNewestFirst(normalizedFallback)),
    postIdsCount: postIds.length,
    itemModuleCount: Object.keys(itemModule).length,
    joinedItemsCount: joinedItems.length,
    normalizedCount: normalizedFallback.length,
    source: `${source}:fallback-itemModule`,
  };
}

function extractTikTokData(bodyText: string, username: string, request: Request): TikTokDataExtraction {
  const scripts = extractTikTokScripts(bodyText);

  logExtraction(
    `data scripts universal=${String(scripts.hasUniversalData)} sigi=${String(scripts.hasSigiState)} next=${String(
      scripts.nextData !== null
    )}`
  );

  const profile = mergeProfile(
    extractProfileMetaFromStructuredData(scripts.universalData) ??
      extractProfileMetaFromStructuredData(scripts.sigiState) ??
      extractProfileMetaFromStructuredData(scripts.nextData),
    extractProfileMetaWithRegex(bodyText)
  );

  const attempts = [
    extractPostsFromPayload(scripts.universalData, username, request, 'universal'),
    extractPostsFromPayload(scripts.sigiState, username, request, 'sigi'),
    extractPostsFromPayload(scripts.nextData, username, request, 'next'),
  ];

  for (const attempt of attempts) {
    logExtraction(
      `${attempt.source} itemModule=${attempt.itemModuleCount} userPostIds=${attempt.postIdsCount} joined=${attempt.joinedItemsCount} normalized=${attempt.normalizedCount}`
    );
  }

  const winner = attempts.find((attempt) => attempt.posts.length > 0) ?? attempts[0];

  if ((profile.videos ?? 0) > 0 && winner.posts.length === 0) {
    logExtraction('profile reports videos>0 but post extraction returned 0 valid posts');
  }

  return {
    profile,
    posts: winner.posts,
  };
}

function hasAnyProfileValue(profile: TikTokProfileMeta): boolean {
  return Object.values(profile).some((value) => value !== null);
}

function limitPosts(posts: SocialPost[], limit: number): SocialPost[] {
  return posts.slice(0, limit).map((post) => ({
    id: post.id,
    shortcode: post.shortcode,
    caption: post.caption ?? '',
    thumbnail_url: post.thumbnail_url ?? null,
    post_url: post.post_url ?? null,
    timestamp: post.timestamp ?? null,
  }));
}

export async function getTikTokProfile(username: string, limit: number, request: Request): Promise<TikTokProfileResponse> {
  const upstream = await fetchTikTokProfile(username);
  const extracted = extractTikTokData(upstream.bodyText, username, request);

  if (!hasAnyProfileValue(extracted.profile) && extracted.posts.length === 0) {
    throw internalError(
      'Scraper request failed',
      'TikTok returned a profile page but no supported data blobs were parsed. The page may be blocked or format changed.'
    );
  }

  return {
    profile: hasAnyProfileValue(extracted.profile) ? extracted.profile : createEmptyTikTokProfileMeta(),
    posts: limitPosts(extracted.posts, limit),
  };
}
