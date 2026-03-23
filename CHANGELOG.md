# Changelog

## 2.0.0 - 2026-03-23

- Refactored the repository from a Node-oriented Instagram scraper library into a Cloudflare Worker HTTP API.
- Added `GET /health` and `GET /instagram` endpoints with normalized JSON responses.
- Added provider-oriented structure with an Instagram provider and TikTok placeholder.
- Added request validation, JSON error helpers, API-key authentication, CORS handling, and Cloudflare cache support.
- Rewrote project documentation for local Wrangler development, deployment, and Bubble.io integration.
- Removed Node-only runtime assumptions such as Axios- and filesystem-based entrypoints from the production path.
