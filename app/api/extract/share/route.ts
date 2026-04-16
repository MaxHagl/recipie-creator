import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rateLimit';
import { scrapeInstagram } from '@/lib/scraper';
import { uploadVideoToGemini } from '@/lib/videoProcessor';
import { processRecipe } from '@/lib/gemini';
import {
  extractBooleanFlagFromPayload,
  extractPotentialUrlFromPayload,
  getRetryAfterSeconds,
  isGeminiOverloadedError,
  isGeminiQuotaError,
  normalizeInstagramRecipeUrl,
} from '@/lib/extractRouteUtils';

function timingSafeEqualString(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function getBearerToken(authHeader: string | null): string | null {
  if (!authHeader) {
    return null;
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function hasValidShareToken(request: Request): boolean {
  const expectedToken = process.env.SHARE_API_TOKEN?.trim();
  if (!expectedToken) {
    return false;
  }

  const providedToken = getBearerToken(request.headers.get('authorization'));
  if (!providedToken) {
    return false;
  }

  return timingSafeEqualString(expectedToken, providedToken);
}

export async function POST(request: Request) {
  const configuredToken = process.env.SHARE_API_TOKEN?.trim();
  if (!configuredToken) {
    return NextResponse.json(
      { error: 'Share endpoint is not configured' },
      { status: 500 }
    );
  }

  if (!hasValidShareToken(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '127.0.0.1';
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait.' },
      { status: 429 }
    );
  }

  let requestBody: unknown;
  try {
    requestBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const extractedUrl = extractPotentialUrlFromPayload(requestBody);
  if (!extractedUrl) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const dateNightMode = extractBooleanFlagFromPayload(requestBody, [
    'dateNightMode',
    'date_night_mode',
  ]);

  const normalizedUrl = normalizeInstagramRecipeUrl(extractedUrl);
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
          uploaded.mimeType,
          { dateNightMode }
        );
        return NextResponse.json({ html, title, normalizedUrl });
      } catch (videoPipelineError) {
        if (caption.trim().length > 0) {
          console.warn(
            '[extract/share] Video pipeline failed, falling back to caption-only',
            videoPipelineError
          );
          stage = 'gemini';
          const fallbackResult = await processRecipe(caption, undefined, undefined, {
            dateNightMode,
          });

          if (fallbackResult.hasRecipe) {
            return NextResponse.json({
              html: fallbackResult.html,
              title: fallbackResult.title,
              normalizedUrl,
            });
          }

          return NextResponse.json(
            {
              error: 'Could not analyze reel video content. Please retry in a moment.',
            },
            {
              status: 503,
              headers: { 'Retry-After': '30' },
            }
          );
        }
        throw videoPipelineError;
      }
    }

    stage = 'gemini';
    const { html, title } = await processRecipe(caption, undefined, undefined, {
      dateNightMode,
    });
    return NextResponse.json({ html, title, normalizedUrl });
  } catch (error) {
    console.error('[extract/share]', error);

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
        { error: 'Gemini is temporarily busy right now. Please retry shortly.' },
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
