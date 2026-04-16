const INSTAGRAM_CODE_RE = /^[A-Za-z0-9_-]+$/;

export function normalizeInstagramRecipeUrl(rawUrl: string): string | null {
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

export function isGeminiQuotaError(error: unknown): boolean {
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

export function isGeminiOverloadedError(error: unknown): boolean {
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

export function getRetryAfterSeconds(error: unknown): number | undefined {
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
