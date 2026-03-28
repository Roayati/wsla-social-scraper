# wsla-social-scraper

`wsla-social-scraper` is a Cloudflare Worker API that returns Bubble-friendly JSON for social profile feeds.

## Supported endpoints

- `GET /health`
- `GET /instagram?username=<username>&limit=<limit>`
- `GET /tiktok?username=<username>&limit=<limit>`
- `GET /image/<encoded-image-url>`

## Authentication

Set `API_KEY` in Worker env to require requests with `x-api-key`.

> `GET /image/...` is intentionally public so Bubble image elements can fetch thumbnails directly.

## Query validation rules (`/instagram`, `/tiktok`)

- `username` is required
- leading `@` is removed
- surrounding spaces are trimmed
- empty usernames are rejected (`400`)
- `limit` defaults to `5`
- `limit` must be between `1` and `12`

## Response contract

Field names are stable for Bubble mappings.

```json
{
  "platform": "tiktok",
  "username": "exampleuser",
  "count": 2,
  "profile": {
    "followers": 12345,
    "following": 120,
    "likes": 987654,
    "videos": 42
  },
  "posts": [
    {
      "id": "1234567890",
      "shortcode": "1234567890",
      "caption": "Video caption",
      "thumbnail_url": "https://YOUR-WORKER/image/https%3A%2F%2Fp16-sign-va.tiktokcdn.com%2F...",
      "post_url": "https://www.tiktok.com/@exampleuser/video/1234567890",
      "timestamp": 1712345678
    }
  ]
}
```

Rules:
- `profile` always exists
- `posts` always exists and is an array
- numeric counts are numbers or `null`
- unavailable text values use `""`, unavailable URLs/IDs use `null`

## TikTok notes and limitations

- Only public TikTok profiles are supported.
- The Worker uses lightweight fetch + HTML/JSON extraction (no browser automation).
- TikTok markup/data blobs can change or be blocked, so scraping is inherently fragile.
- When possible, thumbnail URLs are proxied through `/image` for Bubble display reliability.

## `/image` proxy behavior

- Accepts encoded upstream image URLs
- Allows only approved Instagram/TikTok CDN host patterns (not an open proxy)
- Applies optional Cloudflare image transforms (`w`, `h`, `q`, `fit`, `format`)
- Returns long cache headers and CORS headers
- Falls back to a default image if upstream fetch fails

## Example curl

```bash
curl "http://127.0.0.1:8787/health"
```

```bash
curl -H "x-api-key: YOUR_KEY" "http://127.0.0.1:8787/instagram?username=benefit.bh&limit=5"
```

```bash
curl -H "x-api-key: YOUR_KEY" "https://YOUR-WORKER/tiktok?username=exampleuser&limit=5"
```

## Local development

```bash
npm install
npm run dev
```

## Deploy

```bash
npm run deploy
```
