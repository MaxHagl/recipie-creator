import { chromium } from 'playwright';

export interface ScrapeResult {
  caption: string;
  videoUrl: string | null;
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
    await context?.close().catch(() => {});
    await browser.close();
  }
}
