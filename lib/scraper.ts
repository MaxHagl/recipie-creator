import { chromium, type Page } from 'playwright';

export interface ScrapeResult {
  caption: string;
  videoUrl: string | null;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
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
    const value = await page.$eval(
      'script[type="application/ld+json"]',
      (el) => {
        const raw = el.textContent ?? '';
        if (!raw) return '';

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

        try {
          const parsed = JSON.parse(raw);
          const descriptions = collectDescriptions(parsed).filter(Boolean);
          return descriptions[0] ?? '';
        } catch {
          return '';
        }
      }
    );

    const normalized = normalizeText(value);
    return normalized.length > 0 ? normalized : null;
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

    const caption =
      (await getMetaContent(page, 'meta[property="og:description"]')) ||
      (await getMetaContent(page, 'meta[name="description"]')) ||
      (await getMetaContent(page, 'meta[property="twitter:description"]')) ||
      (await getJsonLdDescription(page)) ||
      normalizeText(await page.title().catch(() => ''));

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
