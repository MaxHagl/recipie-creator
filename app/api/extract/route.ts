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
