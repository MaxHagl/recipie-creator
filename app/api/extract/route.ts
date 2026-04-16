import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isValidSessionToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rateLimit';
import { scrapeInstagram } from '@/lib/scraper';
import { uploadVideoToGemini } from '@/lib/videoProcessor';
import { processRecipe } from '@/lib/gemini';

const INSTAGRAM_CODE_RE = /^[A-Za-z0-9_-]+$/;

function normalizeInstagramRecipeUrl(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:') {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (host !== 'www.instagram.com' && host !== 'instagram.com') {
    return null;
  }

  const pathSegments = parsed.pathname.split('/').filter(Boolean);
  if (pathSegments.length !== 2) {
    return null;
  }

  const [contentType, shortcode] = pathSegments;
  if ((contentType !== 'p' && contentType !== 'reel') || !INSTAGRAM_CODE_RE.test(shortcode)) {
    return null;
  }

  return `https://www.instagram.com/${contentType}/${shortcode}/`;
}

function isGeminiQuotaError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const status = (error as { status?: number }).status;
  const message = error.message.toLowerCase();

  return (
    status === 429 &&
    (message.includes('quota') ||
      message.includes('rate limit') ||
      message.includes('too many requests'))
  );
}

function isGeminiOverloadedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const status = (error as { status?: number }).status;
  const message = error.message.toLowerCase();

  return (
    status === 503 ||
    message.includes('service unavailable') ||
    message.includes('high demand')
  );
}

function getRetryAfterSeconds(error: unknown): number | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  const errorWithDetails = error as { errorDetails?: unknown[] };

  if (Array.isArray(errorWithDetails.errorDetails)) {
    for (const detail of errorWithDetails.errorDetails) {
      if (detail && typeof detail === 'object') {
        const retryDelay = (detail as { retryDelay?: unknown }).retryDelay;
        if (typeof retryDelay === 'string') {
          const match = retryDelay.match(/^(\d+(?:\.\d+)?)s$/);
          if (match) {
            return Math.max(1, Math.ceil(Number.parseFloat(match[1])));
          }
        }
      }
    }
  }

  const messageMatch = error.message.match(/retry in\s+(\d+(?:\.\d+)?)s/i);
  if (messageMatch) {
    return Math.max(1, Math.ceil(Number.parseFloat(messageMatch[1])));
  }

  return undefined;
}

export async function POST(request: Request) {
  // Auth
  const cookieStore = await cookies();
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
    if (typeof url !== 'string') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const normalizedUrl = normalizeInstagramRecipeUrl(url);

  if (!normalizedUrl) {
    return NextResponse.json({ error: 'Invalid Instagram URL' }, { status: 400 });
  }

  let stage: 'scrape' | 'video' | 'gemini' = 'scrape';

  try {
    const { caption, videoUrl } = await scrapeInstagram(normalizedUrl);

    if (videoUrl) {
      stage = 'video';

      try {
        const uploaded = await uploadVideoToGemini(videoUrl);
        stage = 'gemini';
        const { html, title } = await processRecipe(
          caption,
          uploaded.fileUri,
          uploaded.mimeType
        );
        return NextResponse.json({ html, title });
      } catch (videoPipelineError) {
        // Reel video handling can fail transiently (CDN/Gemini processing). Fall
        // back to caption-only extraction when possible instead of hard-failing.
        if (caption.trim().length > 0) {
          console.warn(
            '[extract] Video pipeline failed, falling back to caption-only',
            videoPipelineError
          );
          stage = 'gemini';
          const { html, title } = await processRecipe(caption);
          return NextResponse.json({ html, title });
        }
        throw videoPipelineError;
      }
    }

    stage = 'gemini';
    const { html, title } = await processRecipe(caption);
    return NextResponse.json({ html, title });
  } catch (error) {
    console.error('[extract]', error);

    if (error instanceof Error && error.message.toLowerCase().includes('login')) {
      return NextResponse.json(
        { error: 'Could not access this post. It may be private.' },
        { status: 422 }
      );
    }

    if (isGeminiQuotaError(error)) {
      const retryAfterSeconds = getRetryAfterSeconds(error);
      const message = retryAfterSeconds
        ? `Gemini API quota exceeded. Please retry in about ${retryAfterSeconds} seconds, or update your Gemini billing/quota settings.`
        : 'Gemini API quota exceeded. Please retry later, or update your Gemini billing/quota settings.';

      return NextResponse.json(
        { error: message },
        {
          status: 429,
          headers:
            retryAfterSeconds !== undefined
              ? { 'Retry-After': String(retryAfterSeconds) }
              : undefined,
        }
      );
    }

    if (isGeminiOverloadedError(error)) {
      const retryAfterSeconds = getRetryAfterSeconds(error) ?? 30;
      return NextResponse.json(
        {
          error:
            'Gemini is temporarily busy right now. Please retry shortly.',
        },
        {
          status: 503,
          headers: { 'Retry-After': String(retryAfterSeconds) },
        }
      );
    }

    if (stage === 'video' || stage === 'gemini') {
      return NextResponse.json({ error: 'Failed to process recipe.' }, { status: 500 });
    }

    return NextResponse.json({ error: 'Failed to fetch the page.' }, { status: 500 });
  }
}
