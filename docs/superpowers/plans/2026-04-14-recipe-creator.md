# Recipe Creator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a password-protected Next.js web app that scrapes Instagram posts/Reels with Playwright, processes the content with Gemini 2.0 Flash (including video), and delivers a self-contained styled `.html` recipe file.

**Architecture:** Single Next.js App Router app deployed on Railway. Server components handle auth cookie checks. Two API routes handle password validation and the full scrape→AI→HTML pipeline. Playwright runs server-side inside the Railway container.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Tailwind CSS, Playwright, `@google/generative-ai`, `bcryptjs`, `dompurify`

---

## File Map

| File | Responsibility |
|---|---|
| `lib/slugify.ts` | Convert recipe title to safe filename |
| `lib/rateLimit.ts` | In-memory 5 req/60s per-IP rate limiter |
| `lib/auth.ts` | Compute + validate HMAC session token |
| `lib/scraper.ts` | Playwright: navigate to URL, extract caption + video URL |
| `lib/videoProcessor.ts` | Download Reel video, upload to Gemini Files API |
| `lib/gemini.ts` | Call Gemini 2.0 Flash (text or multimodal), return `{html, title}` |
| `app/api/auth/route.ts` | POST: validate password, set session cookie |
| `app/api/extract/route.ts` | POST: full pipeline with auth + rate limit guards |
| `components/AuthPage.tsx` | Password form, calls `router.refresh()` on success |
| `components/AppPage.tsx` | Orchestrates RecipeForm + RecipePreview state |
| `components/RecipeForm.tsx` | URL input, loading states, calls `/api/extract` |
| `components/RecipePreview.tsx` | Renders sanitized HTML preview + download button |
| `app/page.tsx` | Server component: reads cookie, routes to AuthPage or AppPage |
| `app/layout.tsx` | Root layout with Tailwind |
| `Dockerfile` | Node 20 + Playwright system deps + Chromium |

---

## Task 1: Project Bootstrap

**Files:**
- Create: `package.json` (via scaffold)
- Create: `.env.local`
- Create: `.env.example`

- [ ] **Step 1: Scaffold Next.js project**

```bash
npx create-next-app@latest . \
  --typescript \
  --tailwind \
  --app \
  --src-dir=no \
  --import-alias="@/*" \
  --no-git
```

Expected: project files created in current directory.

- [ ] **Step 2: Install dependencies**

```bash
npm install bcryptjs @google/generative-ai dompurify playwright
npm install --save-dev @types/bcryptjs @types/dompurify jest @types/jest ts-jest jest-environment-jsdom @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 3: Install Playwright's Chromium browser locally**

```bash
npx playwright install chromium
```

Expected: Chromium binary downloaded to `~/.cache/ms-playwright/`.

- [ ] **Step 4: Create `.env.example`**

```bash
# Generate APP_PASSWORD_HASH:
# node -e "const b=require('bcryptjs'); b.hash('yourpassword',12).then(h=>console.log(h))"
#
# Generate SESSION_SECRET:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

APP_PASSWORD_HASH=
SESSION_SECRET=
GEMINI_API_KEY=
```

- [ ] **Step 5: Create `.env.local` with real values**

Run the two generation commands from `.env.example`, paste results into `.env.local`.

- [ ] **Step 6: Add `.env.local` to `.gitignore`**

Verify `.gitignore` already contains `.env*.local` (create-next-app adds this). If not:

```bash
echo ".env.local" >> .gitignore
```

- [ ] **Step 7: Commit**

```bash
git init
git add -A
git commit -m "feat: scaffold Next.js project with dependencies"
```

---

## Task 2: Jest Configuration

**Files:**
- Create: `jest.config.ts`
- Create: `jest.setup.ts`
- Modify: `tsconfig.json`

- [ ] **Step 1: Create `jest.config.ts`**

```typescript
import type { Config } from 'jest';
import nextJest from 'next/jest.js';

const createJestConfig = nextJest({ dir: './' });

const config: Config = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  testMatch: ['**/__tests__/**/*.test.ts?(x)'],
};

export default createJestConfig(config);
```

- [ ] **Step 2: Create `jest.setup.ts`**

```typescript
import '@testing-library/jest-dom';
```

- [ ] **Step 3: Add test script to `package.json`**

Open `package.json` and add to `"scripts"`:

```json
"test": "jest",
"test:watch": "jest --watch"
```

- [ ] **Step 4: Verify Jest runs**

```bash
npm test -- --passWithNoTests
```

Expected: `Test Suites: 0 passed` (no tests yet).

- [ ] **Step 5: Commit**

```bash
git add jest.config.ts jest.setup.ts package.json
git commit -m "feat: configure Jest with Next.js integration"
```

---

## Task 3: Dockerfile

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

- [ ] **Step 1: Create `Dockerfile`**

```dockerfile
FROM node:20-slim

# Playwright system dependencies for Chromium
RUN apt-get update && apt-get install -y \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libgtk-3-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

# Install Playwright Chromium binary
RUN npx playwright install chromium

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright
EXPOSE 3000

CMD ["npm", "start"]
```

- [ ] **Step 2: Create `.dockerignore`**

```
node_modules
.next
.env.local
.git
__tests__
*.test.ts
*.test.tsx
```

- [ ] **Step 3: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "feat: add Railway-ready Dockerfile with Playwright deps"
```

---

## Task 4: lib/slugify.ts

**Files:**
- Create: `lib/slugify.ts`
- Create: `__tests__/lib/slugify.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/lib/slugify.test.ts`:

```typescript
import { slugify } from '@/lib/slugify';

describe('slugify', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(slugify('Pasta Carbonara')).toBe('pasta-carbonara');
  });

  it('removes special characters', () => {
    expect(slugify('Grandma\'s #1 Soup!')).toBe('grandmas-1-soup');
  });

  it('collapses multiple hyphens', () => {
    expect(slugify('chicken   &   rice')).toBe('chicken-rice');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugify('  -recipe-  ')).toBe('recipe');
  });

  it('returns "recipe" for empty or whitespace-only input', () => {
    expect(slugify('')).toBe('recipe');
    expect(slugify('   ')).toBe('recipe');
  });

  it('handles emoji and unicode gracefully', () => {
    expect(slugify('🍝 Pasta')).toBe('pasta');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- slugify.test.ts
```

Expected: FAIL with "Cannot find module '@/lib/slugify'".

- [ ] **Step 3: Implement `lib/slugify.ts`**

```typescript
export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/[\s-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'recipe'
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- slugify.test.ts
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/slugify.ts __tests__/lib/slugify.test.ts
git commit -m "feat: add slugify utility with tests"
```

---

## Task 5: lib/rateLimit.ts

**Files:**
- Create: `lib/rateLimit.ts`
- Create: `__tests__/lib/rateLimit.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/lib/rateLimit.test.ts`:

```typescript
import { checkRateLimit, _resetStoreForTesting } from '@/lib/rateLimit';

beforeEach(() => {
  _resetStoreForTesting();
});

describe('checkRateLimit', () => {
  it('allows up to 5 requests from the same IP', () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit('1.2.3.4')).toBe(true);
    }
  });

  it('blocks the 6th request from the same IP', () => {
    for (let i = 0; i < 5; i++) checkRateLimit('1.2.3.4');
    expect(checkRateLimit('1.2.3.4')).toBe(false);
  });

  it('does not affect a different IP', () => {
    for (let i = 0; i < 5; i++) checkRateLimit('1.2.3.4');
    expect(checkRateLimit('9.9.9.9')).toBe(true);
  });

  it('resets after the window expires', () => {
    jest.useFakeTimers();
    for (let i = 0; i < 5; i++) checkRateLimit('1.2.3.4');
    jest.advanceTimersByTime(61_000);
    expect(checkRateLimit('1.2.3.4')).toBe(true);
    jest.useRealTimers();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- rateLimit.test.ts
```

Expected: FAIL with "Cannot find module '@/lib/rateLimit'".

- [ ] **Step 3: Implement `lib/rateLimit.ts`**

```typescript
interface Entry {
  count: number;
  windowStart: number;
}

const store = new Map<string, Entry>();
const MAX = 5;
const WINDOW_MS = 60_000;

export function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = store.get(ip);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    store.set(ip, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= MAX) return false;

  entry.count++;
  return true;
}

/** Only exported for tests — do not call in application code. */
export function _resetStoreForTesting(): void {
  store.clear();
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- rateLimit.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/rateLimit.ts __tests__/lib/rateLimit.test.ts
git commit -m "feat: add in-memory rate limiter with tests"
```

---

## Task 6: lib/auth.ts

**Files:**
- Create: `lib/auth.ts`
- Create: `__tests__/lib/auth.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/lib/auth.test.ts`:

```typescript
describe('auth', () => {
  const originalSecret = process.env.SESSION_SECRET;
  const originalHash = process.env.APP_PASSWORD_HASH;

  beforeEach(() => {
    process.env.SESSION_SECRET = 'test-secret-abc123';
    process.env.APP_PASSWORD_HASH = '$2a$12$fakehash';
    jest.resetModules();
  });

  afterEach(() => {
    process.env.SESSION_SECRET = originalSecret;
    process.env.APP_PASSWORD_HASH = originalHash;
  });

  it('computeSessionToken returns a 64-char hex string', async () => {
    const { computeSessionToken } = await import('@/lib/auth');
    const token = computeSessionToken();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });

  it('isValidSessionToken returns true for correct token', async () => {
    const { computeSessionToken, isValidSessionToken } = await import('@/lib/auth');
    const token = computeSessionToken();
    expect(isValidSessionToken(token)).toBe(true);
  });

  it('isValidSessionToken returns false for wrong token', async () => {
    const { isValidSessionToken } = await import('@/lib/auth');
    expect(isValidSessionToken('deadbeef'.repeat(8))).toBe(false);
  });

  it('isValidSessionToken returns false for garbage input', async () => {
    const { isValidSessionToken } = await import('@/lib/auth');
    expect(isValidSessionToken('')).toBe(false);
    expect(isValidSessionToken('not-hex')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- auth.test.ts
```

Expected: FAIL with "Cannot find module '@/lib/auth'".

- [ ] **Step 3: Implement `lib/auth.ts`**

```typescript
import crypto from 'crypto';

export function computeSessionToken(): string {
  return crypto
    .createHmac('sha256', process.env.SESSION_SECRET!)
    .update(process.env.APP_PASSWORD_HASH!)
    .digest('hex');
}

export function isValidSessionToken(token: string): boolean {
  try {
    const expected = computeSessionToken();
    if (token.length !== expected.length) return false;
    return crypto.timingSafeEqual(
      Buffer.from(token, 'hex'),
      Buffer.from(expected, 'hex')
    );
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- auth.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/auth.ts __tests__/lib/auth.test.ts
git commit -m "feat: add HMAC session token auth helpers with tests"
```

---

## Task 7: lib/scraper.ts

**Files:**
- Create: `lib/scraper.ts`
- Create: `__tests__/lib/scraper.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/lib/scraper.test.ts`:

```typescript
jest.mock('playwright', () => ({
  chromium: {
    launch: jest.fn(),
  },
}));

import { chromium } from 'playwright';
import { scrapeInstagram } from '@/lib/scraper';

const mockLaunch = chromium.launch as jest.Mock;

function makeBrowser(overrides: Partial<{
  caption: string;
  videoUrl: string | null;
  cookieVisible: boolean;
}> = {}) {
  const { caption = 'Test caption', videoUrl = null, cookieVisible = false } = overrides;

  const page = {
    goto: jest.fn().mockResolvedValue(undefined),
    locator: jest.fn().mockReturnValue({
      first: jest.fn().mockReturnValue({
        isVisible: jest.fn().mockResolvedValue(cookieVisible),
        click: jest.fn().mockResolvedValue(undefined),
      }),
    }),
    $eval: jest.fn().mockImplementation((selector: string) => {
      if (selector.includes('og:description')) return Promise.resolve(caption);
      if (selector.includes('og:video')) return videoUrl ? Promise.resolve(videoUrl) : Promise.reject(new Error('not found'));
      return Promise.reject(new Error('unknown selector'));
    }),
  };

  const context = {
    newPage: jest.fn().mockResolvedValue(page),
  };

  const browser = {
    newContext: jest.fn().mockResolvedValue(context),
    close: jest.fn().mockResolvedValue(undefined),
  };

  return { browser, page };
}

describe('scrapeInstagram', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns caption from og:description meta tag', async () => {
    const { browser } = makeBrowser({ caption: 'Pasta recipe here' });
    mockLaunch.mockResolvedValue(browser);

    const result = await scrapeInstagram('https://www.instagram.com/p/abc123/');
    expect(result.caption).toBe('Pasta recipe here');
    expect(result.videoUrl).toBeNull();
  });

  it('returns videoUrl when og:video meta tag exists', async () => {
    const { browser } = makeBrowser({ videoUrl: 'https://example.com/video.mp4' });
    mockLaunch.mockResolvedValue(browser);

    const result = await scrapeInstagram('https://www.instagram.com/reel/abc123/');
    expect(result.videoUrl).toBe('https://example.com/video.mp4');
  });

  it('closes browser even if page throws', async () => {
    const { browser, page } = makeBrowser();
    page.goto.mockRejectedValue(new Error('Navigation failed'));
    mockLaunch.mockResolvedValue(browser);

    await expect(scrapeInstagram('https://www.instagram.com/p/abc/')).rejects.toThrow();
    expect(browser.close).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- scraper.test.ts
```

Expected: FAIL with "Cannot find module '@/lib/scraper'".

- [ ] **Step 3: Implement `lib/scraper.ts`**

```typescript
import { chromium } from 'playwright';

export interface ScrapeResult {
  caption: string;
  videoUrl: string | null;
}

export async function scrapeInstagram(url: string): Promise<ScrapeResult> {
  const browser = await chromium.launch({ headless: true });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Dismiss cookie consent popup if visible
    const cookieBtn = page
      .locator(
        '[data-testid="cookie-policy-manage-dialog-accept-button"], ' +
        'button:has-text("Allow all cookies"), ' +
        'button:has-text("Accept All")'
      )
      .first();

    if (await cookieBtn.isVisible({ timeout: 3_000 })) {
      await cookieBtn.click();
    }

    const caption = await page.$eval(
      'meta[property="og:description"]',
      (el) => (el as HTMLMetaElement).getAttribute('content') ?? ''
    );

    const videoUrl = await page
      .$eval(
        'meta[property="og:video:secure_url"], meta[property="og:video"]',
        (el) => (el as HTMLMetaElement).getAttribute('content') ?? null
      )
      .catch(() => null);

    return { caption, videoUrl };
  } finally {
    await browser.close();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- scraper.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/scraper.ts __tests__/lib/scraper.test.ts
git commit -m "feat: add Playwright Instagram scraper with tests"
```

---

## Task 8: lib/videoProcessor.ts

**Files:**
- Create: `lib/videoProcessor.ts`
- Create: `__tests__/lib/videoProcessor.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/lib/videoProcessor.test.ts`:

```typescript
jest.mock('@google/generative-ai/server', () => ({
  GoogleAIFileManager: jest.fn().mockImplementation(() => ({
    uploadFile: jest.fn().mockResolvedValue({
      file: { uri: 'https://files.gemini/abc', mimeType: 'video/mp4' },
    }),
  })),
}));

jest.mock('fs/promises', () => ({
  writeFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

import { uploadVideoToGemini } from '@/lib/videoProcessor';

describe('uploadVideoToGemini', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)),
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('returns fileUri and mimeType on success', async () => {
    const result = await uploadVideoToGemini('https://example.com/video.mp4');
    expect(result.fileUri).toBe('https://files.gemini/abc');
    expect(result.mimeType).toBe('video/mp4');
  });

  it('throws if video download fails', async () => {
    mockFetch.mockResolvedValue({ ok: false });
    await expect(uploadVideoToGemini('https://bad.url/video.mp4')).rejects.toThrow(
      'Failed to download video'
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- videoProcessor.test.ts
```

Expected: FAIL with "Cannot find module '@/lib/videoProcessor'".

- [ ] **Step 3: Implement `lib/videoProcessor.ts`**

```typescript
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { GoogleAIFileManager } from '@google/generative-ai/server';

export interface VideoUploadResult {
  fileUri: string;
  mimeType: string;
}

export async function uploadVideoToGemini(videoUrl: string): Promise<VideoUploadResult> {
  const response = await fetch(videoUrl);
  if (!response.ok) throw new Error('Failed to download video');

  const buffer = Buffer.from(await response.arrayBuffer());
  const tempPath = path.join(os.tmpdir(), `reel-${Date.now()}.mp4`);

  await fs.writeFile(tempPath, buffer);

  const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY!);

  try {
    const uploadResult = await fileManager.uploadFile(tempPath, {
      mimeType: 'video/mp4',
      displayName: 'instagram-reel',
    });
    return {
      fileUri: uploadResult.file.uri,
      mimeType: uploadResult.file.mimeType,
    };
  } finally {
    await fs.unlink(tempPath).catch(() => {});
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- videoProcessor.test.ts
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/videoProcessor.ts __tests__/lib/videoProcessor.test.ts
git commit -m "feat: add Gemini video upload processor with tests"
```

---

## Task 9: lib/gemini.ts

**Files:**
- Create: `lib/gemini.ts`
- Create: `__tests__/lib/gemini.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/lib/gemini.test.ts`:

```typescript
const mockGenerateContent = jest.fn();

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: mockGenerateContent,
    }),
  })),
}));

import { processRecipe } from '@/lib/gemini';

describe('processRecipe', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
  });

  afterEach(() => jest.clearAllMocks());

  it('returns html and extracted title', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => '<html><body><h1>Pasta Carbonara</h1></body></html>' },
    });

    const result = await processRecipe('pasta recipe caption');
    expect(result.html).toContain('<h1>Pasta Carbonara</h1>');
    expect(result.title).toBe('Pasta Carbonara');
  });

  it('strips markdown code fences from response', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => '```html\n<html><body><h1>Soup</h1></body></html>\n```',
      },
    });

    const result = await processRecipe('soup caption');
    expect(result.html).not.toContain('```');
    expect(result.title).toBe('Soup');
  });

  it('returns empty title if no h1 found', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => '<p>No recipe found in this post.</p>' },
    });

    const result = await processRecipe('random caption');
    expect(result.title).toBe('');
  });

  it('includes fileData part when videoFileUri is provided', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => '<html><body><h1>Reel Recipe</h1></body></html>' },
    });

    await processRecipe('caption', 'https://files.gemini/abc', 'video/mp4');

    const callArgs = mockGenerateContent.mock.calls[0][0];
    const fileDataPart = callArgs.find((p: { fileData?: unknown }) => p.fileData);
    expect(fileDataPart).toBeDefined();
    expect(fileDataPart.fileData.fileUri).toBe('https://files.gemini/abc');
  });

  it('throws if no content is provided', async () => {
    await expect(processRecipe('')).rejects.toThrow('No content to process');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- gemini.test.ts
```

Expected: FAIL with "Cannot find module '@/lib/gemini'".

- [ ] **Step 3: Implement `lib/gemini.ts`**

```typescript
import { GoogleGenerativeAI, Part } from '@google/generative-ai';

const SYSTEM_PROMPT = `You are a recipe formatting assistant. You will receive raw text extracted from \
an Instagram post or Reel (caption, on-screen text, and/or transcribed speech). \
Extract ONLY the recipe content and format it as a clean, self-contained HTML \
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
- Embed all CSS inline in a <style> tag. Make it clean, readable, mobile-friendly.`;

export interface RecipeResult {
  html: string;
  title: string;
}

function extractTitle(html: string): string {
  const match = html.match(/<h1[^>]*>(.*?)<\/h1>/i);
  return match ? match[1].replace(/<[^>]+>/g, '').trim() : '';
}

function stripCodeFences(text: string): string {
  return text
    .replace(/^```(?:html)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

export async function processRecipe(
  caption: string,
  videoFileUri?: string,
  videoMimeType?: string
): Promise<RecipeResult> {
  const parts: Part[] = [];

  if (videoFileUri && videoMimeType) {
    parts.push({ fileData: { mimeType: videoMimeType, fileUri: videoFileUri } });
  }

  if (caption) {
    parts.push({ text: `Caption: ${caption}` });
  }

  if (parts.length === 0) throw new Error('No content to process');

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: SYSTEM_PROMPT,
  });

  const result = await model.generateContent(parts);
  const html = stripCodeFences(result.response.text());

  return { html, title: extractTitle(html) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- gemini.test.ts
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/gemini.ts __tests__/lib/gemini.test.ts
git commit -m "feat: add Gemini recipe processor with tests"
```

---

## Task 10: POST /api/auth route

**Files:**
- Create: `app/api/auth/route.ts`
- Create: `__tests__/api/auth.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/api/auth.test.ts`:

```typescript
jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
}));

jest.mock('@/lib/auth', () => ({
  computeSessionToken: jest.fn().mockReturnValue('abc123token'),
}));

import bcrypt from 'bcryptjs';
import { POST } from '@/app/api/auth/route';

const mockCompare = bcrypt.compare as jest.Mock;

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth', () => {
  beforeEach(() => {
    process.env.APP_PASSWORD_HASH = '$2a$12$fakehash';
  });

  afterEach(() => jest.clearAllMocks());

  it('returns 200 and sets session cookie on correct password', async () => {
    mockCompare.mockResolvedValue(true);
    const res = await POST(makeRequest({ password: 'correct' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('session=');
  });

  it('returns 401 on wrong password', async () => {
    mockCompare.mockResolvedValue(false);
    const res = await POST(makeRequest({ password: 'wrong' }));
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });

  it('returns 400 if password field is missing', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- api/auth.test.ts
```

Expected: FAIL with "Cannot find module '@/app/api/auth/route'".

- [ ] **Step 3: Implement `app/api/auth/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { computeSessionToken } from '@/lib/auth';

export async function POST(request: Request) {
  let password: unknown;

  try {
    const body = await request.json();
    password = body.password;
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!password || typeof password !== 'string') {
    return NextResponse.json({ error: 'Password required' }, { status: 400 });
  }

  const isValid = await bcrypt.compare(password, process.env.APP_PASSWORD_HASH!);

  if (!isValid) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }

  const token = computeSessionToken();
  const response = NextResponse.json({ success: true });

  response.cookies.set('session', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });

  return response;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- api/auth.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add app/api/auth/route.ts __tests__/api/auth.test.ts
git commit -m "feat: add auth API route with tests"
```

---

## Task 11: POST /api/extract route

**Files:**
- Create: `app/api/extract/route.ts`
- Create: `__tests__/api/extract.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/api/extract.test.ts`:

```typescript
jest.mock('next/headers', () => ({
  cookies: jest.fn(),
}));

jest.mock('@/lib/auth', () => ({
  isValidSessionToken: jest.fn(),
}));

jest.mock('@/lib/rateLimit', () => ({
  checkRateLimit: jest.fn().mockReturnValue(true),
}));

jest.mock('@/lib/scraper', () => ({
  scrapeInstagram: jest.fn(),
}));

jest.mock('@/lib/videoProcessor', () => ({
  uploadVideoToGemini: jest.fn(),
}));

jest.mock('@/lib/gemini', () => ({
  processRecipe: jest.fn(),
}));

import { cookies } from 'next/headers';
import { isValidSessionToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rateLimit';
import { scrapeInstagram } from '@/lib/scraper';
import { uploadVideoToGemini } from '@/lib/videoProcessor';
import { processRecipe } from '@/lib/gemini';
import { POST } from '@/app/api/extract/route';

const mockCookies = cookies as jest.Mock;
const mockIsValid = isValidSessionToken as jest.Mock;
const mockRateLimit = checkRateLimit as jest.Mock;
const mockScrape = scrapeInstagram as jest.Mock;
const mockUpload = uploadVideoToGemini as jest.Mock;
const mockProcess = processRecipe as jest.Mock;

function makeRequest(body: unknown, ip = '1.2.3.4') {
  return new Request('http://localhost/api/extract', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

function mockAuth(valid = true) {
  mockCookies.mockReturnValue({ get: () => ({ value: 'token' }) });
  mockIsValid.mockReturnValue(valid);
}

describe('POST /api/extract', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns 401 if session cookie is missing', async () => {
    mockCookies.mockReturnValue({ get: () => undefined });
    mockIsValid.mockReturnValue(false);
    const res = await POST(makeRequest({ url: 'https://www.instagram.com/p/abc/' }));
    expect(res.status).toBe(401);
  });

  it('returns 429 if rate limit exceeded', async () => {
    mockAuth();
    mockRateLimit.mockReturnValue(false);
    const res = await POST(makeRequest({ url: 'https://www.instagram.com/p/abc/' }));
    expect(res.status).toBe(429);
  });

  it('returns 400 for invalid Instagram URL', async () => {
    mockAuth();
    const res = await POST(makeRequest({ url: 'https://evil.com/inject' }));
    expect(res.status).toBe(400);
    expect(mockScrape).not.toHaveBeenCalled();
  });

  it('returns 200 with html and title for a valid post URL', async () => {
    mockAuth();
    mockScrape.mockResolvedValue({ caption: 'pasta recipe', videoUrl: null });
    mockProcess.mockResolvedValue({ html: '<h1>Pasta</h1>', title: 'Pasta' });

    const res = await POST(makeRequest({ url: 'https://www.instagram.com/p/abc123/' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.html).toContain('<h1>Pasta</h1>');
    expect(data.title).toBe('Pasta');
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('uploads video when scraper returns a videoUrl', async () => {
    mockAuth();
    mockScrape.mockResolvedValue({ caption: 'reel recipe', videoUrl: 'https://example.com/v.mp4' });
    mockUpload.mockResolvedValue({ fileUri: 'https://files.gemini/x', mimeType: 'video/mp4' });
    mockProcess.mockResolvedValue({ html: '<h1>Reel Recipe</h1>', title: 'Reel Recipe' });

    const res = await POST(makeRequest({ url: 'https://www.instagram.com/reel/abc123/' }));
    expect(res.status).toBe(200);
    expect(mockUpload).toHaveBeenCalledWith('https://example.com/v.mp4');
  });

  it('returns 500 on scraper crash without leaking error details', async () => {
    mockAuth();
    mockScrape.mockRejectedValue(new Error('Chromium crashed unexpectedly at 0xDEADBEEF'));

    const res = await POST(makeRequest({ url: 'https://www.instagram.com/p/abc123/' }));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).not.toContain('Chromium');
    expect(data.error).not.toContain('0xDEADBEEF');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- api/extract.test.ts
```

Expected: FAIL with "Cannot find module '@/app/api/extract/route'".

- [ ] **Step 3: Implement `app/api/extract/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isValidSessionToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rateLimit';
import { scrapeInstagram } from '@/lib/scraper';
import { uploadVideoToGemini } from '@/lib/videoProcessor';
import { processRecipe } from '@/lib/gemini';

const INSTAGRAM_URL_RE =
  /^https:\/\/www\.instagram\.com\/(p|reel)\/[A-Za-z0-9_-]+\/?$/;

export async function POST(request: Request) {
  // Auth
  const cookieStore = cookies();
  const session = cookieStore.get('session');
  if (!session || !isValidSessionToken(session.value)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Rate limit
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '127.0.0.1';
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait.' },
      { status: 429 }
    );
  }

  // Parse + validate URL
  let url: string;
  try {
    const body = await request.json();
    url = body.url;
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!url || !INSTAGRAM_URL_RE.test(url)) {
    return NextResponse.json({ error: 'Invalid Instagram URL' }, { status: 400 });
  }

  try {
    const { caption, videoUrl } = await scrapeInstagram(url);

    let videoFileUri: string | undefined;
    let videoMimeType: string | undefined;

    if (videoUrl) {
      const uploaded = await uploadVideoToGemini(videoUrl);
      videoFileUri = uploaded.fileUri;
      videoMimeType = uploaded.mimeType;
    }

    const { html, title } = await processRecipe(caption, videoFileUri, videoMimeType);
    return NextResponse.json({ html, title });
  } catch (error) {
    console.error('[extract]', error);

    if (error instanceof Error && error.message.toLowerCase().includes('login')) {
      return NextResponse.json(
        { error: 'Could not access this post. It may be private.' },
        { status: 422 }
      );
    }

    return NextResponse.json({ error: 'Failed to fetch the page.' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- api/extract.test.ts
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add app/api/extract/route.ts __tests__/api/extract.test.ts
git commit -m "feat: add extract API route with full pipeline and tests"
```

---

## Task 12: AuthPage component

**Files:**
- Create: `components/AuthPage.tsx`
- Create: `__tests__/components/AuthPage.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `__tests__/components/AuthPage.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AuthPage } from '@/components/AuthPage';

const mockRefresh = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

global.fetch = jest.fn();
const mockFetch = global.fetch as jest.Mock;

describe('AuthPage', () => {
  afterEach(() => jest.clearAllMocks());

  it('renders password input and submit button', () => {
    render(<AuthPage />);
    expect(screen.getByPlaceholderText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enter/i })).toBeInTheDocument();
  });

  it('calls router.refresh() on successful auth', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    render(<AuthPage />);
    fireEvent.change(screen.getByPlaceholderText(/password/i), {
      target: { value: 'secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: /enter/i }));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it('shows error message on failed auth', async () => {
    mockFetch.mockResolvedValue({ ok: false });
    render(<AuthPage />);
    fireEvent.change(screen.getByPlaceholderText(/password/i), {
      target: { value: 'wrong' },
    });
    fireEvent.click(screen.getByRole('button', { name: /enter/i }));
    await waitFor(() =>
      expect(screen.getByText(/invalid password/i)).toBeInTheDocument()
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- AuthPage.test.tsx
```

Expected: FAIL with "Cannot find module '@/components/AuthPage'".

- [ ] **Step 3: Implement `components/AuthPage.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function AuthPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    if (res.ok) {
      router.refresh();
    } else {
      setError('Invalid password');
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 w-full max-w-sm">
        <h1 className="text-xl font-semibold text-gray-900 mb-6 text-center">
          Recipe Creator
        </h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
            className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-400"
            autoFocus
          />
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full py-2 px-4 bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Checking…' : 'Enter'}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- AuthPage.test.tsx
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add components/AuthPage.tsx __tests__/components/AuthPage.test.tsx
git commit -m "feat: add AuthPage component with tests"
```

---

## Task 13: RecipeForm component

**Files:**
- Create: `components/RecipeForm.tsx`
- Create: `__tests__/components/RecipeForm.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `__tests__/components/RecipeForm.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RecipeForm } from '@/components/RecipeForm';

global.fetch = jest.fn();
const mockFetch = global.fetch as jest.Mock;
const mockOnResult = jest.fn();

describe('RecipeForm', () => {
  afterEach(() => jest.clearAllMocks());

  it('renders URL input and submit button', () => {
    render(<RecipeForm onResult={mockOnResult} />);
    expect(screen.getByPlaceholderText(/instagram/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /extract recipe/i })).toBeInTheDocument();
  });

  it('submit button is disabled when input is empty', () => {
    render(<RecipeForm onResult={mockOnResult} />);
    expect(screen.getByRole('button', { name: /extract recipe/i })).toBeDisabled();
  });

  it('calls onResult with html and title on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ html: '<h1>Pasta</h1>', title: 'Pasta' }),
    });

    render(<RecipeForm onResult={mockOnResult} />);
    fireEvent.change(screen.getByPlaceholderText(/instagram/i), {
      target: { value: 'https://www.instagram.com/p/abc/' },
    });
    fireEvent.click(screen.getByRole('button', { name: /extract recipe/i }));

    await waitFor(() =>
      expect(mockOnResult).toHaveBeenCalledWith('<h1>Pasta</h1>', 'Pasta')
    );
  });

  it('shows error message on API failure', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: jest.fn().mockResolvedValue({ error: 'Invalid Instagram URL' }),
    });

    render(<RecipeForm onResult={mockOnResult} />);
    fireEvent.change(screen.getByPlaceholderText(/instagram/i), {
      target: { value: 'https://www.instagram.com/p/abc/' },
    });
    fireEvent.click(screen.getByRole('button', { name: /extract recipe/i }));

    await waitFor(() =>
      expect(screen.getByText(/invalid instagram url/i)).toBeInTheDocument()
    );
    expect(mockOnResult).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- RecipeForm.test.tsx
```

Expected: FAIL with "Cannot find module '@/components/RecipeForm'".

- [ ] **Step 3: Implement `components/RecipeForm.tsx`**

```tsx
'use client';

import { useState } from 'react';

interface RecipeFormProps {
  onResult: (html: string, title: string) => void;
}

const STATUSES = ['Fetching page…', 'Processing with AI…'];

export function RecipeForm({ onResult }: RecipeFormProps) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusIdx, setStatusIdx] = useState(0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    setStatusIdx(0);

    const timer = setTimeout(() => setStatusIdx(1), 8_000);

    try {
      const res = await fetch('/api/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      const data = await res.json();

      if (res.ok) {
        onResult(data.html, data.title);
        setUrl('');
      } else {
        setError(data.error ?? 'Something went wrong.');
      }
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.instagram.com/reel/…"
          className="flex-1 px-4 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-400 text-sm"
        />
        <button
          type="submit"
          disabled={loading || !url}
          className="px-5 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 whitespace-nowrap text-sm transition-colors"
        >
          {loading ? 'Working…' : 'Extract Recipe'}
        </button>
      </div>
      {loading && (
        <p className="text-gray-400 text-sm">{STATUSES[statusIdx]}</p>
      )}
      {error && <p className="text-red-500 text-sm">{error}</p>}
    </form>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- RecipeForm.test.tsx
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add components/RecipeForm.tsx __tests__/components/RecipeForm.test.tsx
git commit -m "feat: add RecipeForm component with tests"
```

---

## Task 14: RecipePreview component

**Files:**
- Create: `components/RecipePreview.tsx`
- Create: `__tests__/components/RecipePreview.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `__tests__/components/RecipePreview.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { RecipePreview } from '@/components/RecipePreview';

// dompurify needs the DOM
jest.mock('dompurify', () => ({
  sanitize: (html: string) => html,
}));

const mockOnReset = jest.fn();

// Mock URL.createObjectURL
global.URL.createObjectURL = jest.fn().mockReturnValue('blob:fake');
global.URL.revokeObjectURL = jest.fn();

describe('RecipePreview', () => {
  afterEach(() => jest.clearAllMocks());

  it('renders recipe title in header', () => {
    render(
      <RecipePreview html="<h1>Pasta</h1>" title="Pasta" onReset={mockOnReset} />
    );
    expect(screen.getByText('Pasta')).toBeInTheDocument();
  });

  it('renders HTML content', () => {
    render(
      <RecipePreview
        html="<p data-testid='content'>Ingredients</p>"
        title="Test"
        onReset={mockOnReset}
      />
    );
    expect(screen.getByTestId('content')).toBeInTheDocument();
  });

  it('calls onReset when Try another is clicked', () => {
    render(
      <RecipePreview html="<h1>Soup</h1>" title="Soup" onReset={mockOnReset} />
    );
    fireEvent.click(screen.getByRole('button', { name: /try another/i }));
    expect(mockOnReset).toHaveBeenCalled();
  });

  it('Download button creates a link with slugified filename', () => {
    const appendSpy = jest.spyOn(document.body, 'appendChild').mockImplementation(() => document.createElement('a'));
    const clickSpy = jest.fn();
    jest.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = document.createElement(tag);
      if (tag === 'a') el.click = clickSpy;
      return el;
    });

    render(
      <RecipePreview html="<h1>Pasta Carbonara</h1>" title="Pasta Carbonara" onReset={mockOnReset} />
    );
    fireEvent.click(screen.getByRole('button', { name: /download/i }));
    expect(clickSpy).toHaveBeenCalled();

    appendSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- RecipePreview.test.tsx
```

Expected: FAIL with "Cannot find module '@/components/RecipePreview'".

- [ ] **Step 3: Implement `components/RecipePreview.tsx`**

```tsx
'use client';

import DOMPurify from 'dompurify';
import { slugify } from '@/lib/slugify';

interface RecipePreviewProps {
  html: string;
  title: string;
  onReset: () => void;
}

export function RecipePreview({ html, title, onReset }: RecipePreviewProps) {
  const cleanHtml = DOMPurify.sanitize(html);

  function handleDownload() {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slugify(title) || 'recipe'}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mt-8 border border-gray-200 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-6 py-3 bg-gray-50 border-b border-gray-200">
        <span className="text-sm font-medium text-gray-700 truncate mr-4">
          {title || 'Recipe'}
        </span>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={handleDownload}
            className="text-sm px-4 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            Download .html
          </button>
          <button
            onClick={onReset}
            className="text-sm px-4 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
          >
            Try another
          </button>
        </div>
      </div>
      <div
        className="p-6 prose max-w-none"
        dangerouslySetInnerHTML={{ __html: cleanHtml }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- RecipePreview.test.tsx
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add components/RecipePreview.tsx __tests__/components/RecipePreview.test.tsx
git commit -m "feat: add RecipePreview component with download and tests"
```

---

## Task 15: AppPage + page.tsx

**Files:**
- Create: `components/AppPage.tsx`
- Modify: `app/page.tsx`
- Modify: `app/layout.tsx`

- [ ] **Step 1: Create `components/AppPage.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { RecipeForm } from './RecipeForm';
import { RecipePreview } from './RecipePreview';

interface RecipeResult {
  html: string;
  title: string;
}

export function AppPage() {
  const [result, setResult] = useState<RecipeResult | null>(null);

  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">Recipe Creator</h1>
        <p className="text-gray-400 text-sm mb-8">
          Paste an Instagram post or Reel URL to extract the recipe.
        </p>
        <RecipeForm onResult={(html, title) => setResult({ html, title })} />
        {result && (
          <RecipePreview
            html={result.html}
            title={result.title}
            onReset={() => setResult(null)}
          />
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Replace `app/page.tsx`**

Open `app/page.tsx` (created by scaffold) and replace its contents entirely:

```tsx
import { cookies } from 'next/headers';
import { isValidSessionToken } from '@/lib/auth';
import { AuthPage } from '@/components/AuthPage';
import { AppPage } from '@/components/AppPage';

export default async function Home() {
  const cookieStore = cookies();
  const session = cookieStore.get('session');
  const isAuthenticated = !!session && isValidSessionToken(session.value);

  if (!isAuthenticated) return <AuthPage />;
  return <AppPage />;
}
```

- [ ] **Step 3: Update `app/layout.tsx` metadata**

Open `app/layout.tsx` and update the metadata:

```tsx
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Recipe Creator',
  description: 'Extract recipes from Instagram',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
```

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Start dev server and verify manually**

```bash
npm run dev
```

Open `http://localhost:3000`. Verify:
- Auth screen appears
- Wrong password shows error
- Correct password navigates to main app
- URL input accepts Instagram URLs
- "Extract Recipe" button is disabled when empty

- [ ] **Step 6: Commit**

```bash
git add components/AppPage.tsx app/page.tsx app/layout.tsx
git commit -m "feat: wire up page routing with server-side auth gate"
```

---

## Task 16: Railway Deployment

**Files:**
- Create: `railway.json` (optional config)

- [ ] **Step 1: Create Railway project**

Go to [railway.app](https://railway.app), create a new project, choose "Deploy from GitHub repo", connect your repo.

- [ ] **Step 2: Set environment variables in Railway dashboard**

In the Railway service settings → Variables, add:

```
APP_PASSWORD_HASH=<your bcrypt hash>
SESSION_SECRET=<your 32-byte hex secret>
GEMINI_API_KEY=<your Gemini API key>
NODE_ENV=production
```

- [ ] **Step 3: Verify Railway uses the Dockerfile**

Railway auto-detects the `Dockerfile` in the repo root and uses it. No extra config needed.

- [ ] **Step 4: Trigger a deploy**

Push to the connected branch:

```bash
git push origin main
```

Monitor the Railway build logs. Expected build sequence:
1. Docker build starts
2. `apt-get install` installs Chromium system deps
3. `npm ci` installs Node packages
4. `npx playwright install chromium` downloads browser binary (~130MB)
5. `npm run build` compiles Next.js
6. Container starts, Railway assigns a public URL

- [ ] **Step 5: Smoke test the live URL**

Open the Railway-provided URL. Verify:
- Auth screen loads over HTTPS
- Login works
- Submit an Instagram post URL (text-heavy caption) and confirm recipe HTML is returned and downloadable
- Submit an Instagram Reel URL and confirm video processing works

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: complete Recipe Creator — ready for Railway deployment"
```

---

## Run All Tests

```bash
npm test
```

Expected final output: all test suites pass with no failures.
