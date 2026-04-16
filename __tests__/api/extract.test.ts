jest.mock('next/headers', () => ({
  cookies: jest.fn(),
}));

jest.mock('@/lib/auth', () => ({
  isValidSessionToken: jest.fn(),
}));

jest.mock('@/lib/rateLimit', () => ({
  checkRateLimit: jest.fn().mockReturnValue(true),
}));

jest.mock('@/lib/scraper', () => ({
  scrapeInstagram: jest.fn(),
}));

jest.mock('@/lib/videoProcessor', () => ({
  uploadVideoToGemini: jest.fn(),
}));

jest.mock('@/lib/gemini', () => ({
  processRecipe: jest.fn(),
}));

import { cookies } from 'next/headers';
import { isValidSessionToken } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rateLimit';
import { scrapeInstagram } from '@/lib/scraper';
import { uploadVideoToGemini } from '@/lib/videoProcessor';
import { processRecipe } from '@/lib/gemini';
import { POST } from '@/app/api/extract/route';

const mockCookies = cookies as jest.Mock;
const mockIsValid = isValidSessionToken as jest.Mock;
const mockRateLimit = checkRateLimit as jest.Mock;
const mockScrape = scrapeInstagram as jest.Mock;
const mockUpload = uploadVideoToGemini as jest.Mock;
const mockProcess = processRecipe as jest.Mock;

function makeRequest(body: unknown, ip = '1.2.3.4') {
  return new Request('http://localhost/api/extract', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

function mockAuth(valid = true) {
  mockCookies.mockResolvedValue({ get: () => ({ value: 'token' }) });
  mockIsValid.mockReturnValue(valid);
}

describe('POST /api/extract', () => {
  beforeEach(() => {
    mockRateLimit.mockReturnValue(true); // reset to allowed before each test
  });

  afterEach(() => jest.clearAllMocks());

  it('returns 401 if session cookie is missing', async () => {
    mockCookies.mockResolvedValue({ get: () => undefined });
    mockIsValid.mockReturnValue(false);
    const res = await POST(makeRequest({ url: 'https://www.instagram.com/p/abc/' }));
    expect(res.status).toBe(401);
    expect(mockScrape).not.toHaveBeenCalled();
  });

  it('returns 429 if rate limit exceeded', async () => {
    mockAuth();
    mockRateLimit.mockReturnValue(false);
    const res = await POST(makeRequest({ url: 'https://www.instagram.com/p/abc/' }));
    expect(res.status).toBe(429);
  });

  it('returns 400 for invalid Instagram URL', async () => {
    mockAuth();
    const res = await POST(makeRequest({ url: 'https://evil.com/inject' }));
    expect(res.status).toBe(400);
    expect(mockScrape).not.toHaveBeenCalled();
  });

  it('returns 200 with html and title for a valid post URL', async () => {
    mockAuth();
    mockScrape.mockResolvedValue({ caption: 'pasta recipe', videoUrl: null });
    mockProcess.mockResolvedValue({ html: '<h1>Pasta</h1>', title: 'Pasta' });

    const res = await POST(makeRequest({ url: 'https://www.instagram.com/p/abc123/' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.html).toContain('<h1>Pasta</h1>');
    expect(data.title).toBe('Pasta');
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('uploads video when scraper returns a videoUrl', async () => {
    mockAuth();
    mockScrape.mockResolvedValue({ caption: 'reel recipe', videoUrl: 'https://example.com/v.mp4' });
    mockUpload.mockResolvedValue({ fileUri: 'https://files.gemini/x', mimeType: 'video/mp4' });
    mockProcess.mockResolvedValue({ html: '<h1>Reel Recipe</h1>', title: 'Reel Recipe' });

    const res = await POST(makeRequest({ url: 'https://www.instagram.com/reel/abc123/' }));
    expect(res.status).toBe(200);
    expect(mockUpload).toHaveBeenCalledWith('https://example.com/v.mp4');
  });

  it('falls back to caption-only processing when reel video pipeline fails', async () => {
    mockAuth();
    mockScrape.mockResolvedValue({
      caption: 'fallback caption recipe',
      videoUrl: 'https://example.com/v.mp4',
    });
    mockUpload.mockRejectedValue(new Error('video upload failed'));
    mockProcess.mockResolvedValue({
      html: '<h1>Caption Fallback</h1>',
      title: 'Caption Fallback',
    });

    const res = await POST(makeRequest({ url: 'https://www.instagram.com/reel/abc123/' }));
    expect(res.status).toBe(200);
    expect(mockUpload).toHaveBeenCalledWith('https://example.com/v.mp4');
    expect(mockProcess).toHaveBeenCalledWith('fallback caption recipe');
  });

  it('returns 500 on scraper crash without leaking error details', async () => {
    mockAuth();
    mockScrape.mockRejectedValue(new Error('Chromium crashed unexpectedly at 0xDEADBEEF'));

    const res = await POST(makeRequest({ url: 'https://www.instagram.com/p/abc123/' }));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).not.toContain('Chromium');
    expect(data.error).not.toContain('0xDEADBEEF');
  });

  it('returns 422 when scraper throws a login-required error', async () => {
    mockAuth();
    mockScrape.mockRejectedValue(new Error('instagram requires login'));
    const res = await POST(makeRequest({ url: 'https://www.instagram.com/p/abc123/' }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toContain('private');
  });

  it('returns 429 with Retry-After header when Gemini quota is exceeded', async () => {
    mockAuth();
    mockScrape.mockResolvedValue({ caption: 'pasta recipe', videoUrl: null });
    const quotaError = Object.assign(
      new Error('Please retry in 36.84s. Quota exceeded.'),
      {
        status: 429,
        errorDetails: [
          {
            '@type': 'type.googleapis.com/google.rpc.RetryInfo',
            retryDelay: '36s',
          },
        ],
      }
    );
    mockProcess.mockRejectedValue(quotaError);

    const res = await POST(makeRequest({ url: 'https://www.instagram.com/p/abc123/' }));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('36');
    const data = await res.json();
    expect(data.error.toLowerCase()).toContain('quota');
  });
});
