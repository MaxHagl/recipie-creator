const INSTAGRAM_CODE_RE = /^[A-Za-z0-9_-]+$/;
const EMBEDDED_URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

function findFirstUrlCandidate(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  try {
    // Already a raw URL.
    // eslint-disable-next-line no-new
    new URL(trimmed);
    return trimmed;
  } catch {
    // Continue and try extracting URL from a text blob.
  }

  const matches = trimmed.match(EMBEDDED_URL_RE) ?? [];
  for (const rawMatch of matches) {
    const cleaned = rawMatch.replace(/[.,!?;:]+$/g, '');
    try {
      // eslint-disable-next-line no-new
      new URL(cleaned);
      return cleaned;
    } catch {
      // Keep scanning.
    }
  }

  return null;
}

export function extractPotentialUrlFromPayload(payload: unknown): string | null {
  const queue: unknown[] = [payload];
  const seen = new Set<object>();
  const priorityKeys = [
    'url',
    'link',
    'href',
    'input',
    'text',
    'sharedUrl',
    'shared_url',
  ];

  while (queue.length > 0) {
    const current = queue.shift();

    if (typeof current === 'string') {
      const candidate = findFirstUrlCandidate(current);
      if (candidate) {
        return candidate;
      }
      continue;
    }

    if (Array.isArray(current)) {
      for (const item of current) queue.push(item);
      continue;
    }

    if (current && typeof current === 'object') {
      const obj = current as Record<string, unknown>;
      if (seen.has(obj)) {
        continue;
      }
      seen.add(obj);

      for (const key of priorityKeys) {
        if (Object.hasOwn(obj, key)) {
          queue.unshift(obj[key]);
        }
      }

      for (const value of Object.values(obj)) {
        queue.push(value);
      }
    }
  }

  return null;
}

function extractCanonicalPathFromSegments(segments: string[]): string | null {
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]?.toLowerCase();
    const next = segments[i + 1];
    const nextNext = segments[i + 2];

    if ((seg === 'p' || seg === 'reel') && next && INSTAGRAM_CODE_RE.test(next)) {
      return `/${seg}/${next}/`;
    }

    if (
      seg === 'share' &&
      (next?.toLowerCase() === 'p' || next?.toLowerCase() === 'reel') &&
      nextNext &&
      INSTAGRAM_CODE_RE.test(nextNext)
    ) {
      return `/${next.toLowerCase()}/${nextNext}/`;
    }
  }

  return null;
}

export function normalizeInstagramRecipeUrl(rawUrl: string): string | null {
  const candidate = findFirstUrlCandidate(rawUrl);
  if (!candidate) return null;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:') {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (host === 'l.instagram.com') {
    const wrapped = parsed.searchParams.get('u');
    return wrapped ? normalizeInstagramRecipeUrl(wrapped) : null;
  }

  if (host !== 'www.instagram.com' && host !== 'instagram.com' && host !== 'm.instagram.com') {
    return null;
  }

  const pathSegments = parsed.pathname.split('/').filter(Boolean);
  const canonicalPath = extractCanonicalPathFromSegments(pathSegments);
  return canonicalPath ? `https://www.instagram.com${canonicalPath}` : null;
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
