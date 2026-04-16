# Recipe Creator

Password-protected Next.js app that extracts recipes from Instagram posts/Reels and formats them as a downloadable self-contained `.html` recipe file.

## Features

- Server-side auth gate using signed session cookie
- Per-IP in-memory rate limiting (`5 req / 60s`)
- Instagram scraping via Playwright
- Gemini processing for caption-only and video-assisted extraction
- Sanitized recipe preview + one-click `.html` download

## Requirements

- Node.js 20+
- Environment variables in `.env.local`:
  - `APP_PASSWORD_HASH`
  - `SESSION_SECRET`
  - `GEMINI_API_KEY`
  - `SHARE_API_TOKEN` (required for iPhone Share Shortcut endpoint)
  - `SHOPPING_SHORTCUT_NAME` (optional, defaults to `AddHTMLTask`)

Use `.env.example` for generation commands.

## Local Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Testing

```bash
npm test
```

## Production Build

```bash
npm run build
npm run start
```

## API Endpoints

- `POST /api/auth`: validate password and set session cookie
- `POST /api/extract`: authenticated scrape -> optional video upload -> Gemini recipe HTML output
- `POST /api/extract/share`: token-authenticated variant for mobile Share Shortcuts (`Authorization: Bearer <SHARE_API_TOKEN>`)
