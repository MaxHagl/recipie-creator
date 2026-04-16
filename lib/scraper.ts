import { chromium, type Page } from 'playwright';

export interface ScrapeResult {
  caption: string;
  videoUrl: string | null;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

const RECIPE_HINT_RE =
  /\b(recipe|ingredients?|instructions?|servings?|prep|cook|bake|fry|boil|simmer|saute|grill|mix|stir|whisk|marinate|zutaten|zubereitung|ingredientes?|instrucciones?)\b/i;
const MEASUREMENT_HINT_RE =
  /\b\d+\s*(?:\/\s*\d+)?\s*(?:g|kg|ml|l|oz|lb|lbs|cup|cups|tbsp|tsp|teaspoons?|tablespoons?)\b/i;
const GENERIC_INSTAGRAM_RE = /\b(?:likes?|comments?)\b[\s\S]*\bon instagram\b/i;

function decodeEscapedCaptionValue(rawValue: string): string {
  return rawValue
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    )
    .replace(/\\n|\\r|\\t/g, ' ')
    .replace(/\\"/g, '"')
    .replace(/\\\//g, '/')
    .replace(/\\\\/g, '\\');
}

function extractQuotedInstagramCaption(value: string): string | null {
  const quotedMatch = value.match(/on instagram:\s*[“"](.+?)[”"]\s*$/i);
  if (quotedMatch?.[1]) {
    const normalized = normalizeText(quotedMatch[1]);
    return normalized.length > 0 ? normalized : null;
  }

  return null;
}

function captionQualityScore(value: string): number {
  const normalized = normalizeText(value);
  if (!normalized) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 0;

  if (RECIPE_HINT_RE.test(normalized)) score += 3;
  if (MEASUREMENT_HINT_RE.test(normalized)) score += 3;
  if (normalized.length >= 80) score += 1;
  if (GENERIC_INSTAGRAM_RE.test(normalized)) score -= 2;
  if (/^instagram$/i.test(normalized)) score -= 5;

  return score;
}

function selectBestCaption(candidates: Array<string | null | undefined>): string {
  const unique = [...new Set(candidates.map((value) => normalizeText(value)).filter(Boolean))];
  if (unique.length === 0) {
    return '';
  }

  let best = unique[0];
  let bestScore = captionQualityScore(best);

  for (const candidate of unique.slice(1)) {
    const score = captionQualityScore(candidate);
    if (score > bestScore || (score === bestScore && candidate.length > best.length)) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

async function getMetaContent(
  page: Page,
  selector: string
): Promise<string | null> {
  try {
    const value = await page.$eval(
      selector,
      (el) => (el as HTMLMetaElement).getAttribute('content') ?? ''
    );
    const normalized = normalizeText(value);
    return normalized.length > 0 ? normalized : null;
  } catch {
    return null;
  }
}

async function getJsonLdDescription(
  page: Page
): Promise<string | null> {
  try {
    const values = await page.$$eval(
      'script[type="application/ld+json"]',
      (els) => {
        const collectDescriptions = (node: unknown): string[] => {
          if (!node || typeof node !== 'object') return [];
          if (Array.isArray(node)) {
            return node.flatMap((item) => collectDescriptions(item));
          }

          const obj = node as Record<string, unknown>;
          const descriptions: string[] = [];

          for (const [key, value] of Object.entries(obj)) {
            if (
              (key.toLowerCase() === 'description' || key.toLowerCase() === 'caption') &&
              typeof value === 'string'
            ) {
              descriptions.push(value);
            } else if (value && typeof value === 'object') {
              descriptions.push(...collectDescriptions(value));
            }
          }

          return descriptions;
        };

        const extracted: string[] = [];
        for (const el of els) {
          const raw = el.textContent ?? '';
          if (!raw) continue;

          try {
            const parsed = JSON.parse(raw);
            extracted.push(...collectDescriptions(parsed).filter(Boolean));
          } catch {
            // Skip malformed JSON-LD block.
          }
        }

        return extracted;
      }
    );

    const best = selectBestCaption(values);
    return best.length > 0 ? best : null;
  } catch {
    return null;
  }
}

async function getEmbeddedCaptionFallback(
  page: Page
): Promise<string | null> {
  try {
    const html = await page.content();
    const patterns = [
      /"edge_media_to_caption"\s*:\s*\{"edges"\s*:\s*\[\{"node"\s*:\s*\{"text"\s*:\s*"((?:\\.|[^"\\])+)"/gi,
      /"accessibility_caption"\s*:\s*"((?:\\.|[^"\\])+)"/gi,
      /"caption"\s*:\s*"((?:\\.|[^"\\])+)"/gi,
      /"description"\s*:\s*"((?:\\.|[^"\\])+)"/gi,
    ];

    const candidates: string[] = [];
    for (const pattern of patterns) {
      for (const match of html.matchAll(pattern)) {
        const value = decodeEscapedCaptionValue(match[1] ?? '');
        const normalized = normalizeText(value);
        if (normalized.length >= 24) {
          candidates.push(normalized);
        }
      }
    }

    const best = selectBestCaption(candidates);
    return best.length > 0 ? best : null;
  } catch {
    return null;
  }
}

export async function scrapeInstagram(url: string): Promise<ScrapeResult> {
  const browser = await chromium.launch({ headless: true });

  let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;

  try {
    context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Dismiss cookie consent popup if visible
    try {
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
    } catch {
      // Cookie popup not found or dismissed — continue
    }

    const ogDescription = await getMetaContent(page, 'meta[property="og:description"]');
    const metaDescription = await getMetaContent(page, 'meta[name="description"]');
    const twitterDescription = await getMetaContent(
      page,
      'meta[property="twitter:description"]'
    );
    const jsonLdDescription = await getJsonLdDescription(page);
    const embeddedFallback = await getEmbeddedCaptionFallback(page);
    const pageTitle = normalizeText(await page.title().catch(() => ''));

    const caption = selectBestCaption([
      extractQuotedInstagramCaption(ogDescription ?? ''),
      extractQuotedInstagramCaption(metaDescription ?? ''),
      ogDescription,
      metaDescription,
      twitterDescription,
      jsonLdDescription,
      embeddedFallback,
      pageTitle,
    ]);

    const videoUrl = await page
      .$eval(
        'meta[property="og:video:secure_url"], meta[property="og:video"]',
        (el) => (el as HTMLMetaElement).getAttribute('content') ?? null
      )
      .catch(() => null);

    return { caption, videoUrl };
  } finally {
    await context?.close().catch(() => {});
    await browser.close();
  }
}
