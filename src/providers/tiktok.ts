import type { SocialPost, SocialProvider } from '../types/social';
import { internalError } from '../utils/errors';

export async function getTikTokPosts(_username: string, _limit = 5): Promise<SocialPost[]> {
  throw internalError('TikTok provider not implemented', 'TODO: add a Cloudflare Worker-compatible TikTok scraping strategy.');
}

export const tiktokProvider: SocialProvider = {
  platform: 'tiktok',
  getPosts: getTikTokPosts,
};
