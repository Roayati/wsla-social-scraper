export type SupportedPlatform = 'instagram' | 'tiktok';

export interface SocialPost {
  id: string | null;
  shortcode: string | null;
  caption: string;
  thumbnail_url: string | null;
  post_url: string | null;
  timestamp: number | null;
}

export interface InstagramProfileMeta {
  total_posts: number | null;
  followers: number | null;
  following: number | null;
}

export interface TikTokProfileMeta {
  followers: number | null;
  following: number | null;
  likes: number | null;
  videos: number | null;
}

export type SocialProfileMeta = InstagramProfileMeta | TikTokProfileMeta;

export interface SocialFeedResponse {
  platform: SupportedPlatform;
  username: string;
  count: number;
  profile: SocialProfileMeta;
  posts: SocialPost[];
}

export interface InstagramProfileResponse {
  profile: InstagramProfileMeta;
  posts: SocialPost[];
}

export interface TikTokProfileResponse {
  profile: TikTokProfileMeta;
  posts: SocialPost[];
}

export interface SocialProvider {
  readonly platform: SupportedPlatform;
  getPosts(username: string, limit: number): Promise<SocialPost[]>;
}
