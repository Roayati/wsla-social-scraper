# wsla-social-scraper

`wsla-social-scraper` is a production-oriented Cloudflare Worker API for fetching normalized social content for Wsla. The project currently supports Instagram and is structured around providers so future platforms like TikTok can be added with minimal refactoring.

## Supported platforms

- **Today:** Instagram
- **Planned next:** TikTok
- **Future-ready:** Additional providers can follow the same shared interface and response contract

## Current API

### `GET /health`
Returns a basic health response.

Example response:

```json
{
  "ok": true,
  "service": "wsla-social-scraper"
}
```

### `GET /instagram?username=benefit.bh&limit=5`
Returns a stable, Bubble-friendly JSON payload of recent posts from a public Instagram profile.

Example response:

```json
{
  "platform": "instagram",
  "username": "benefit.bh",
  "count": 5,
  "posts": [
    {
      "id": null,
      "shortcode": "ABC123",
      "caption": "Post caption",
      "thumbnail_url": "https://...",
      "post_url": "https://www.instagram.com/p/ABC123/",
      "timestamp": 1712345678
    }
  ]
}
```

Field names are intentionally stable and should be treated as the API contract:

- `id`
- `shortcode`
- `caption`
- `thumbnail_url`
- `post_url`
- `timestamp`

## Architecture

```text
src/
  index.ts
  providers/
    instagram.ts
    tiktok.ts
  types/
    social.ts
  utils/
    errors.ts
    json.ts
    validation.ts
```

### Design goals

- **Cloudflare Worker first:** no Node-only HTTP server runtime
- **Fetch-based scraping:** Worker-compatible requests to public Instagram endpoints
- **Upstream diagnostics:** logs upstream status codes plus a 500-character response preview for Instagram fetches
- **Provider-based structure:** easy to extend with TikTok later
- **Stable JSON contract:** suitable for Bubble.io and other low-code consumers
- **Operational basics included:** validation, auth, CORS, and cache support

## Requirements

- Node.js 18.18+
- npm
- A Cloudflare account for deployment

## Local setup

Install dependencies:

```bash
npm install
```

Create local environment variables:

```bash
cp .dev.vars.example .dev.vars
```

Then edit `.dev.vars` and set your API key:

```dotenv
API_KEY=replace-with-a-secret-key
```

## Environment variables

### `API_KEY`
Optional but recommended. When set, requests must include:

```http
x-api-key: <secret>
```

Behavior:

- If `API_KEY` is **not set**, the Worker allows requests without authentication.
- If `API_KEY` **is set**, missing or incorrect `x-api-key` values return `401`.

## Running locally with Wrangler

Start the local Worker:

```bash
npm run dev
```

Wrangler will typically expose the Worker at:

```text
http://127.0.0.1:8787
```

## Deploying to Cloudflare Workers

Authenticate with Cloudflare if needed:

```bash
npx wrangler login
```

Deploy:

```bash
npm run deploy
```

The Worker configuration lives in `wrangler.jsonc`.

## Example curl requests

Health check:

```bash
curl "http://127.0.0.1:8787/health"
```

Instagram request with auth:

```bash
curl -H "x-api-key: YOUR_KEY" "http://127.0.0.1:8787/instagram?username=benefit.bh&limit=5"
```

Instagram request showing username normalization:

```bash
curl -H "x-api-key: YOUR_KEY" "http://127.0.0.1:8787/instagram?username=@benefit.bh&limit=5"
```

## Bubble API Connector example

A simple Bubble.io setup can look like this:

- **Method:** `GET`
- **URL:** `https://YOUR_WORKER_DOMAIN/instagram?username=<dynamic username>&limit=5`
- **Headers:**
  - `x-api-key: YOUR_KEY`
- **Use as:** Data
- **Expected response type:** JSON

Recommended Bubble patterns:

- Keep `username` dynamic from your Bubble app.
- Keep `limit` in the `1..12` range.
- Store `x-api-key` in a private server-side setting whenever possible.
- Prefer Bubble workflows or backend calls rather than exposing secrets in the browser.

## Validation rules

### Username normalization

The Worker will:

- trim surrounding spaces
- remove a leading `@`
- reject empty usernames
- reject obviously invalid Instagram usernames

### Limit normalization

The Worker will:

- default to `5`
- enforce a minimum of `1`
- enforce a maximum of `12`

## Error format

Errors always return JSON in this shape:

```json
{
  "error": "Short human readable message",
  "details": "Optional technical details when useful"
}
```

Status codes used:

- `400` invalid input
- `401` missing or invalid API key
- `404` unknown route
- `500` scraper or runtime failure

For Instagram scraper failures, the JSON error shape stays the same while `details` now includes richer upstream context for common anti-bot or throttling cases such as upstream `403`, upstream `429`, and unexpected HTML responses.

## CORS

The Worker returns the following CORS headers:

- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET, OPTIONS`
- `Access-Control-Allow-Headers: content-type, x-api-key`

`OPTIONS` requests are handled explicitly for browser-based integrations.

## Cache behavior

For `GET /instagram`:

- Cloudflare `caches.default` is used
- cache key is based on the full request URL
- only successful responses are cached
- `Cache-Control` is set to `public, max-age=300`

This reduces repeated upstream scraping and helps protect the Worker from unnecessary load.

## Important limitations

- **Public profiles only:** private Instagram accounts are not supported.
- **Scraping can break:** Instagram may change response formats or anti-bot behavior at any time. The Worker now logs the upstream status code and the first 500 characters of the upstream body to make these failures easier to diagnose.
- **Caching is recommended:** repeated real-time scraping is inherently fragile.
- **No browser automation:** this Worker intentionally avoids Puppeteer, Playwright, or similar tooling.
- **Upstream dependency:** response quality depends on public Instagram endpoint availability.

## Migration notes from the original repository

This repository started from `aduptive/instagram-scraper`, which was designed as a Node-friendly TypeScript scraping library. To make it practical for Cloudflare Workers, the production path was changed in these ways:

- replaced Axios-based runtime requests with Worker-native `fetch`
- removed filesystem-dependent JSON export behavior from the main product path
- replaced library-style entrypoints with a Worker `fetch(request, env, ctx)` handler
- reduced the Instagram mapping to a stable API contract designed for downstream consumers
- introduced provider interfaces and shared social types for future expansion

## Development notes

If you add a new platform later:

1. create a new provider in `src/providers/`
2. return the shared `SocialPost` shape
3. add a route in `src/index.ts`
4. keep response field names stable for Bubble and other API consumers

## License

MIT.
