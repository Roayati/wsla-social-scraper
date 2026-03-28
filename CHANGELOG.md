# Changelog

## 2.4.0 - 2026-03-28

- Added `GET /tiktok?username=<username>&limit=<limit>` with Bubble-friendly response shape (`platform`, `username`, `count`, `profile`, `posts`) and stable post field names (`id`, `shortcode`, `caption`, `thumbnail_url`, `post_url`, `timestamp`).
- Implemented a Cloudflare Worker-compatible TikTok provider (`src/providers/tiktok.ts`) using lightweight fetch-based parsing with layered extraction strategies: embedded structured JSON scripts, alternate blobs, then regex fallbacks.
- Added TikTok profile meta extraction (`followers`, `following`, `likes`, `videos`) with graceful partial responses when only profile or posts are available.
- Added TikTok route handling in `src/index.ts`, including the same validation, error, cache, and response style used by existing endpoints.
- Extended `/image` host validation to allow approved TikTok CDN host suffixes while preserving Instagram support and avoiding open-proxy behavior.
- Updated shared social types, README documentation, and package metadata for TikTok support.

## 2.3.0 - 2026-03-26

- Upgraded `GET /image/<encoded>` to support optional transformation query params: `w`, `h`, `q`, `fit`, and `format`.
- Added automatic output format negotiation (`avif`/`webp`/`jpeg`) based on the request `Accept` header when `format=auto` or `format` is omitted.
- Refactored image proxying to use Cloudflare Worker image transformations (`fetch(..., { cf: { image: ... } })`) with safe fallbacks to raw upstream fetches if transformation fails or is unavailable.
- Kept backward compatibility for existing Bubble usage: `/instagram` JSON field names and `thumbnail_url` contract remain unchanged.
- Added validation/clamping for transform params (`w`/`h` max 2000, `q` clamped to 40..95, fit/format allowlists) and cache-key normalization to include transform settings.
- Extended fallback-image behavior so transform settings are also applied to the fallback image when possible.
- Updated README and package metadata to document transform support, auto format negotiation, caching behavior, and Cloudflare requirements/caveats.

## 2.2.1 - 2026-03-26

- Updated the `/image/<encoded>` proxy path to use a one-year immutable browser cache policy (`cache-control: public, max-age=31536000, immutable`) for faster repeat thumbnail loads.
- Added an image fetch fallback path so upstream Instagram image failures now return a default profile image instead of a JSON error response.
- Updated README and package metadata to document the new fallback behavior and long-lived image cache strategy.

## 2.2.0 - 2026-03-26

- Added a new public `GET /image/<encoded>` endpoint that validates Instagram CDN URLs, fetches and returns binary image bodies, applies CORS plus long-lived immutable cache headers, and caches successful image responses in `caches.default`.
- Updated `/instagram` post mapping so `thumbnail_url` keeps the same field name but now returns a Worker-proxied image URL instead of the raw Instagram CDN URL.
- Added reusable image-proxy helpers to build proxied thumbnail URLs from the incoming Worker origin and safely proxy/validate encoded Instagram image URLs without creating an open proxy.
- Updated README and package metadata to document automatic thumbnail proxying for Bubble hotlink/display reliability and Worker-layer image caching behavior.

## 2.1.1 - 2026-03-23

- Hardened the shared Worker response helper so every JSON response path now returns explicit Bubble-friendly JSON, cache-control, and CORS headers.
- Rebuilt cached `/instagram` responses before returning them so cache hits preserve the same headers as fresh responses.
- Updated the README and package metadata to document the stricter response-header contract for Bubble plugin and server-side requests.

## 2.1.0 - 2026-03-23

- Added Instagram `profile.total_posts`, `profile.followers`, and `profile.following` to the `/instagram` API response while preserving the existing posts payload.
- Extended the Instagram provider to read profile counts from structured profile data and fall back to regex extraction when those counts are missing.
- Updated the Worker handler, shared types, package metadata, and README examples to document the richer Bubble-friendly response contract.

## 2.0.1 - 2026-03-23

- Logged the Instagram upstream HTTP status and a 500-character response preview for faster incident triage.
- Strengthened the Instagram request header set to look more like a modern Android mobile browser request.
- Added more detailed scraper error details for upstream `403`, upstream `429`, and unexpected HTML responses while preserving the public API response contract.
- Clarified the README documentation to describe the new upstream diagnostics and scraper failure behavior.

## 2.0.0 - 2026-03-23

- Refactored the repository from a Node-oriented Instagram scraper library into a Cloudflare Worker HTTP API.
- Added `GET /health` and `GET /instagram` endpoints with normalized JSON responses.
- Added provider-oriented structure with an Instagram provider and TikTok placeholder.
- Added request validation, JSON error helpers, API-key authentication, CORS handling, and Cloudflare cache support.
- Rewrote project documentation for local Wrangler development, deployment, and Bubble.io integration.
- Removed Node-only runtime assumptions such as Axios- and filesystem-based entrypoints from the production path.
