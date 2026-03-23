export type SupportedPlatform = 'instagram' | 'tiktok';

export interface SocialPost {
  id: string | null;
  shortcode: string | null;
  caption: string;
  thumbnail_url: string | null;
  post_url: string | null;
  timestamp: number | null;
}

export interface SocialFeedResponse {
  platform: SupportedPlatform;
  username: string;
  count: number;
  posts: SocialPost[];
}

export interface SocialProvider {
  readonly platform: SupportedPlatform;
  getPosts(username: string, limit: number): Promise<SocialPost[]>;
}
