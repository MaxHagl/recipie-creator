jest.mock('playwright', () => ({
  chromium: {
    launch: jest.fn(),
  },
}));

import { chromium } from 'playwright';
import { scrapeInstagram } from '@/lib/scraper';

const mockLaunch = chromium.launch as jest.Mock;

function makeBrowser(overrides: Partial<{
  caption: string;
  videoUrl: string | null;
  cookieVisible: boolean;
}> = {}) {
  const { caption = 'Test caption', videoUrl = null, cookieVisible = false } = overrides;

  const page = {
    goto: jest.fn().mockResolvedValue(undefined),
    locator: jest.fn().mockReturnValue({
      first: jest.fn().mockReturnValue({
        isVisible: jest.fn().mockResolvedValue(cookieVisible),
        click: jest.fn().mockResolvedValue(undefined),
      }),
    }),
    $eval: jest.fn().mockImplementation((selector: string) => {
      if (selector.includes('og:description')) return Promise.resolve(caption);
      if (selector.includes('og:video')) return videoUrl ? Promise.resolve(videoUrl) : Promise.reject(new Error('not found'));
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
    const { browser } = makeBrowser({ caption: 'Pasta recipe here' });
    mockLaunch.mockResolvedValue(browser);

    const result = await scrapeInstagram('https://www.instagram.com/p/abc123/');
    expect(result.caption).toBe('Pasta recipe here');
    expect(result.videoUrl).toBeNull();
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
