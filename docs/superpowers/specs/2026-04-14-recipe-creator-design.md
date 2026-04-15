# Recipe Creator — Design Spec
**Date:** 2026-04-14  
**Status:** Approved

---

## Overview

A personal web app that extracts recipes from Instagram posts and Reels, processes them with Gemini AI, and delivers a clean self-contained `.html` recipe file. Deployed as a single Next.js app on Railway.

---

## Tech Stack

| Concern | Choice | Reason |
|---|---|---|
| Framework | Next.js (App Router) | Single repo, API routes + frontend |
| Deployment | Railway | Persistent server — supports 60s+ timeouts needed for video processing |
| Scraping | Playwright + Chromium (self-hosted) | Naive approach, free, no external API dependency |
| AI | Google Gemini 2.0 Flash (`gemini-2.0-flash`) | Multimodal: handles text + video |
| Styling | Tailwind CSS | Clean, minimal UI |
| Auth | bcrypt password hash in env + session cookie | Lightweight, no DB needed |

---

## File Structure

```
app/
  page.tsx              ← auth gate + main UI (conditional render)
  layout.tsx
  api/
    auth/route.ts       ← POST: validate password, set HttpOnly session cookie
    extract/route.ts    ← POST: full scrape → AI → HTML pipeline
components/
  AuthForm.tsx          ← password input screen
  RecipeForm.tsx        ← URL input + submit
  RecipePreview.tsx     ← rendered HTML preview + download button
lib/
  scraper.ts            ← Playwright: launch → navigate → dismiss popups → extract caption + video URL
  videoProcessor.ts     ← download Reel video → upload to Gemini Files API
  gemini.ts             ← Gemini API call (text-only or multimodal)
  rateLimit.ts          ← in-memory rate limiter
  auth.ts               ← cookie read/write helpers
.env.local              ← APP_PASSWORD_HASH, GEMINI_API_KEY
Dockerfile              ← installs Chromium + Playwright system deps on Railway
```

---

## Core Pipeline — POST /api/extract

1. **Validate URL** — regex match against `^https:\/\/www\.instagram\.com\/(p|reel)\/[A-Za-z0-9_-]+\/?$`. Reject immediately if no match.
2. **Check rate limit** — 5 requests / 60s per IP. Return 429 if exceeded.
3. **Check auth cookie** — return 401 if missing or invalid.
4. **Playwright scrape** — launch Chromium, navigate to URL, dismiss cookie/login popups, extract caption text. If Reel: also extract video file URL.
5. **Video processing (Reels only)** — download video → upload to Gemini Files API → get file URI.
6. **Gemini call** — send caption text + video file URI (if present). System prompt instructs Gemini to output a self-contained styled HTML recipe document.
7. **Return** `{ html: string, title: string }` to client.

---

## Authentication

- `APP_PASSWORD_HASH` env var holds bcrypt hash of the master password.
- `POST /api/auth` validates submitted password against hash, sets cookie:
  - `HttpOnly: true`
  - `SameSite: Strict`
  - `Secure: true`
  - No `Max-Age` — session cookie, expires on browser close.
- `page.tsx` reads cookie server-side; renders `<AuthForm>` or main app accordingly.

---

## Input Validation

```
^https:\/\/www\.instagram\.com\/(p|reel)\/[A-Za-z0-9_-]+\/?$
```

- Accepts: `/p/` posts and `/reel/` reels only.
- Rejects: stories, profiles, DMs, explore pages, malformed URLs.
- Playwright never initialises until this passes.

---

## Rate Limiting

- **Storage:** In-memory `Map<ip, { count: number, windowStart: number }>`
- **Limit:** 5 requests per 60-second rolling window per IP
- **Response on breach:** HTTP 429, generic message
- **Note:** Resets on Railway process restart (acceptable for personal tool)

---

## UI Flow

### Screen 1 — Auth
- Centered card, password field, submit button
- Wrong password → inline error, no redirect

### Screen 2 — Main App
- URL input field + "Extract Recipe" button
- Loading state: spinner with status text ("Fetching page…", "Processing with AI…")
- Success: `<RecipePreview>` renders below with:
  - Styled HTML preview via `dangerouslySetInnerHTML`
  - "Download .html" button (top-right of card)
  - "Try another" button to reset
- Error: red inline message, no page reload

---

## Output Format

The downloaded file is a fully self-contained HTML document:
- `<!DOCTYPE html>` + `<style>` block with embedded CSS
- Clean recipe card layout, mobile-friendly, printable
- Works offline — no external dependencies
- **Filename:** recipe title slugified + `.html` (e.g. `pasta-carbonara.html`). Falls back to `recipe.html` if no title is extractable.

---

## Gemini System Prompt

```
You are a recipe formatting assistant. You will receive raw text extracted from 
an Instagram post or Reel (caption, on-screen text, and/or transcribed speech). 
Extract ONLY the recipe content and format it as a clean, self-contained HTML 
document with embedded CSS.

Structure:
- Recipe title (h1)
- Servings / time metadata if present (small tag)
- Ingredients (ul)
- Instructions (ol)
- Notes / tips if present (blockquote)

Rules:
- Do NOT include any Instagram-specific text (hashtags, @mentions, CTAs, follower prompts)
- If no recipe is found, return a single paragraph: "No recipe found in this post."
- Output ONLY valid HTML. No markdown. No explanation. No code fences.
- Embed all CSS inline in a <style> tag. Make it clean, readable, mobile-friendly.
```

---

## Error Handling

| Error | Client Response | Server Behavior |
|---|---|---|
| Playwright crash / timeout | "Failed to fetch the page." | Log full error server-side |
| Instagram login wall | "Could not access this post. It may be private." | Log, return 422 |
| Gemini API error | "Failed to process recipe." | Log full error server-side |
| No recipe found | Display Gemini's "No recipe found" message | Normal flow |
| Rate limit exceeded | "Too many requests. Please wait." | Return 429 |

No stack traces or raw error objects ever sent to the client.

---

## Environment Variables

```
APP_PASSWORD_HASH=   # bcrypt hash of master password
GEMINI_API_KEY=      # Google AI Studio API key
```

---

## Deployment — Railway

- `Dockerfile` installs Node.js + Playwright system deps + Chromium; Railway uses this to build and run the app (Dockerfile takes precedence over auto-detection)
- Single service, single repo
- No `vercel.json` needed

---

## Out of Scope

- Multi-user accounts
- Recipe storage / history
- Image/thumbnail extraction
- Stories or private account support
- Proxy rotation (can be added later if Railway IPs get blocked)
