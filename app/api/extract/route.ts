import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isValidSessionToken } from '@/lib/auth';
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

const REEL_RETRY_MESSAGE =
  'Could not analyze reel video content. Please retry in a moment.';

function isReelRequestUrl(url: string): boolean {
  return /\/reel\/[A-Za-z0-9_-]+\/?$/i.test(url);
}

function shouldTreatAsRecipeResult(result: { hasRecipe?: boolean }): boolean {
  return result.hasRecipe !== false;
}

function buildReelRetryResponse() {
  return NextResponse.json(
    { error: REEL_RETRY_MESSAGE },
    {
      status: 503,
      headers: { 'Retry-After': '30' },
    }
  );
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
  const reelRequest = isReelRequestUrl(normalizedUrl);

  let stage: 'scrape' | 'video' | 'gemini' = 'scrape';

  try {
    const { caption, videoUrl } = await scrapeInstagram(normalizedUrl);

    if (videoUrl) {
      stage = 'video';

      try {
        const uploaded = await uploadVideoToGemini(videoUrl);
        stage = 'gemini';
        const videoResult = await processRecipe(
          caption,
          uploaded.fileUri,
          uploaded.mimeType,
          { dateNightMode }
        );
        if (shouldTreatAsRecipeResult(videoResult)) {
          return NextResponse.json({ html: videoResult.html, title: videoResult.title });
        }

        if (caption.trim().length > 0) {
          const fallbackResult = await processRecipe(caption, undefined, undefined, {
            dateNightMode,
          });
          if (shouldTreatAsRecipeResult(fallbackResult)) {
            return NextResponse.json({
              html: fallbackResult.html,
              title: fallbackResult.title,
            });
          }
        }

        return buildReelRetryResponse();
      } catch (videoPipelineError) {
        // Reel video handling can fail transiently (CDN/Gemini processing). Fall
        // back to caption-only extraction when possible instead of hard-failing.
        if (caption.trim().length > 0) {
          console.warn(
            '[extract] Video pipeline failed, falling back to caption-only',
            videoPipelineError
          );
          stage = 'gemini';
          const fallbackResult = await processRecipe(caption, undefined, undefined, {
            dateNightMode,
          });

          if (shouldTreatAsRecipeResult(fallbackResult)) {
            return NextResponse.json({
              html: fallbackResult.html,
              title: fallbackResult.title,
            });
          }

          return buildReelRetryResponse();
        }
        throw videoPipelineError;
      }
    }

    stage = 'gemini';
    const fallbackResult = await processRecipe(caption, undefined, undefined, {
      dateNightMode,
    });
    if (reelRequest && !shouldTreatAsRecipeResult(fallbackResult)) {
      return buildReelRetryResponse();
    }
    return NextResponse.json({ html: fallbackResult.html, title: fallbackResult.title });
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
