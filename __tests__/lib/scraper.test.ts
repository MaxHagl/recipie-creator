jest.mock('playwright', () => ({
  chromium: {
    launch: jest.fn(),
  },
}));

import { chromium } from 'playwright';
import { scrapeInstagram } from '@/lib/scraper';

const mockLaunch = chromium.launch as jest.Mock;

function makeBrowser(overrides: Partial<{
  ogCaption: string | null;
  metaDescription: string | null;
  twitterDescription: string | null;
  jsonLdDescription: string | null;
  pageTitle: string;
  videoUrl: string | null;
  cookieVisible: boolean;
}> = {}) {
  const {
    ogCaption = 'Test caption',
    metaDescription = null,
    twitterDescription = null,
    jsonLdDescription = null,
    pageTitle = '',
    videoUrl = null,
    cookieVisible = false,
  } = overrides;

  const page = {
    goto: jest.fn().mockResolvedValue(undefined),
    locator: jest.fn().mockReturnValue({
      first: jest.fn().mockReturnValue({
        isVisible: jest.fn().mockResolvedValue(cookieVisible),
        click: jest.fn().mockResolvedValue(undefined),
      }),
    }),
    title: jest.fn().mockResolvedValue(pageTitle),
    $eval: jest.fn().mockImplementation((selector: string, pageFn: (el: {
      getAttribute: (name: string) => string | null;
      textContent: string | null;
    }) => unknown) => {
      if (selector.includes('og:description')) {
        if (ogCaption == null) return Promise.reject(new Error('not found'));
        return Promise.resolve(pageFn({
          getAttribute: () => ogCaption,
          textContent: null,
        }));
      }
      if (selector.includes('meta[name="description"]')) {
        if (metaDescription == null) return Promise.reject(new Error('not found'));
        return Promise.resolve(pageFn({
          getAttribute: () => metaDescription,
          textContent: null,
        }));
      }
      if (selector.includes('twitter:description')) {
        if (twitterDescription == null) return Promise.reject(new Error('not found'));
        return Promise.resolve(pageFn({
          getAttribute: () => twitterDescription,
          textContent: null,
        }));
      }
      if (selector.includes('application/ld+json')) {
        if (jsonLdDescription == null) return Promise.reject(new Error('not found'));
        return Promise.resolve(pageFn({
          getAttribute: () => null,
          textContent: JSON.stringify({ description: jsonLdDescription }),
        }));
      }
      if (selector.includes('og:video')) {
        return videoUrl
          ? Promise.resolve(pageFn({
            getAttribute: () => videoUrl,
            textContent: null,
          }))
          : Promise.reject(new Error('not found'));
      }
      return Promise.reject(new Error('unknown selector'));
    }),
  };

  const context = {
    newPage: jest.fn().mockResolvedValue(page),
    close: jest.fn().mockResolvedValue(undefined),
  };

  const browser = {
    newContext: jest.fn().mockResolvedValue(context),
    close: jest.fn().mockResolvedValue(undefined),
  };

  return { browser, page, context };
}

describe('scrapeInstagram', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns caption from og:description meta tag', async () => {
    const { browser } = makeBrowser({ ogCaption: 'Pasta recipe here' });
    mockLaunch.mockResolvedValue(browser);

    const result = await scrapeInstagram('https://www.instagram.com/p/abc123/');
    expect(result.caption).toBe('Pasta recipe here');
    expect(result.videoUrl).toBeNull();
  });

  it('falls back to description meta when og:description is missing', async () => {
    const { browser } = makeBrowser({
      ogCaption: null,
      metaDescription: 'Fallback description caption',
    });
    mockLaunch.mockResolvedValue(browser);

    const result = await scrapeInstagram('https://www.instagram.com/p/abc123/');
    expect(result.caption).toBe('Fallback description caption');
  });

  it('returns videoUrl when og:video meta tag exists', async () => {
    const { browser } = makeBrowser({ videoUrl: 'https://example.com/video.mp4' });
    mockLaunch.mockResolvedValue(browser);

    const result = await scrapeInstagram('https://www.instagram.com/reel/abc123/');
    expect(result.videoUrl).toBe('https://example.com/video.mp4');
  });

  it('closes browser even if page throws', async () => {
    const { browser, page, context } = makeBrowser();
    page.goto.mockRejectedValue(new Error('Navigation failed'));
    mockLaunch.mockResolvedValue(browser);

    await expect(scrapeInstagram('https://www.instagram.com/p/abc/')).rejects.toThrow();
    expect(context.close).toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalled();
  });
});
