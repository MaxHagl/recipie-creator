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

import { checkRateLimit } from '@/lib/rateLimit';
import { scrapeInstagram } from '@/lib/scraper';
import { uploadVideoToGemini } from '@/lib/videoProcessor';
import { processRecipe } from '@/lib/gemini';
import { POST } from '@/app/api/extract/share/route';

const mockRateLimit = checkRateLimit as jest.Mock;
const mockScrape = scrapeInstagram as jest.Mock;
const mockUpload = uploadVideoToGemini as jest.Mock;
const mockProcess = processRecipe as jest.Mock;

function makeRequest(
  body: unknown,
  token = 'share-token',
  ip = '1.2.3.4'
) {
  return new Request('http://localhost/api/extract/share', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/extract/share', () => {
  beforeEach(() => {
    process.env.SHARE_API_TOKEN = 'share-token';
    mockRateLimit.mockReturnValue(true);
  });

  afterEach(() => jest.clearAllMocks());

  it('returns 401 if bearer token is missing/invalid', async () => {
    const req = new Request('http://localhost/api/extract/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://www.instagram.com/p/abc123/' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 200 with html and title for valid token and URL', async () => {
    mockScrape.mockResolvedValue({ caption: 'pasta recipe', videoUrl: null });
    mockProcess.mockResolvedValue({ html: '<h1>Pasta</h1>', title: 'Pasta' });

    const res = await POST(
      makeRequest({ url: 'https://www.instagram.com/reel/DW7wNS3Ev8r/?igsh=test' })
    );

    expect(res.status).toBe(200);
    expect(mockScrape).toHaveBeenCalledWith('https://www.instagram.com/reel/DW7wNS3Ev8r/');
    expect(mockProcess).toHaveBeenCalledWith('pasta recipe', undefined, undefined, {
      dateNightMode: false,
    });
    const data = await res.json();
    expect(data.title).toBe('Pasta');
    expect(data.normalizedUrl).toBe('https://www.instagram.com/reel/DW7wNS3Ev8r/');
  });

  it('forwards dateNightMode=true to processRecipe', async () => {
    mockScrape.mockResolvedValue({ caption: 'pasta recipe', videoUrl: null });
    mockProcess.mockResolvedValue({ html: '<h1>Pasta</h1>', title: 'Pasta' });

    const res = await POST(
      makeRequest({
        url: 'https://www.instagram.com/p/abc123/',
        dateNightMode: true,
      })
    );

    expect(res.status).toBe(200);
    expect(mockProcess).toHaveBeenCalledWith('pasta recipe', undefined, undefined, {
      dateNightMode: true,
    });
  });

  it('accepts text blobs that contain an Instagram URL', async () => {
    mockScrape.mockResolvedValue({ caption: 'pasta recipe', videoUrl: null });
    mockProcess.mockResolvedValue({ html: '<h1>Pasta</h1>', title: 'Pasta' });

    const res = await POST(
      makeRequest({
        url:
          'Check this out https://www.instagram.com/reel/DW7wNS3Ev8r/?igsh=test sent from instagram',
      })
    );

    expect(res.status).toBe(200);
    expect(mockScrape).toHaveBeenCalledWith('https://www.instagram.com/reel/DW7wNS3Ev8r/');
  });

  it('accepts array-style payloads from share sheet wrappers', async () => {
    mockScrape.mockResolvedValue({ caption: 'pasta recipe', videoUrl: null });
    mockProcess.mockResolvedValue({ html: '<h1>Pasta</h1>', title: 'Pasta' });

    const res = await POST(
      makeRequest({
        url: [
          'https://www.instagram.com/reel/DW7wNS3Ev8r/?igsh=test',
        ],
      })
    );

    expect(res.status).toBe(200);
    expect(mockScrape).toHaveBeenCalledWith('https://www.instagram.com/reel/DW7wNS3Ev8r/');
  });

  it('returns 429 if rate limit exceeded', async () => {
    mockRateLimit.mockReturnValue(false);
    const res = await POST(
      makeRequest({ url: 'https://www.instagram.com/p/abc123/' })
    );
    expect(res.status).toBe(429);
  });

  it('returns 429 with Retry-After header when Gemini quota is exceeded', async () => {
    mockScrape.mockResolvedValue({ caption: 'pasta recipe', videoUrl: null });
    mockProcess.mockRejectedValue(
      Object.assign(new Error('Quota exceeded. retry in 12.2s'), {
        status: 429,
      })
    );

    const res = await POST(
      makeRequest({ url: 'https://www.instagram.com/p/abc123/' })
    );
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('13');
  });

  it('falls back to caption-only when reel video processing fails', async () => {
    mockScrape.mockResolvedValue({
      caption: 'fallback caption recipe',
      videoUrl: 'https://example.com/video.mp4',
    });
    mockUpload.mockRejectedValue(new Error('video upload failed'));
    mockProcess.mockResolvedValue({
      html: '<h1>Fallback</h1>',
      title: 'Fallback',
    });

    const res = await POST(
      makeRequest({ url: 'https://www.instagram.com/reel/abc123/' })
    );

    expect(res.status).toBe(200);
    expect(mockUpload).toHaveBeenCalledWith('https://example.com/video.mp4');
    expect(mockProcess).toHaveBeenCalledWith('fallback caption recipe', undefined, undefined, {
      dateNightMode: false,
    });
  });
});
