jest.mock('@google/generative-ai/server', () => ({
  FileState: {
    PROCESSING: 'PROCESSING',
    ACTIVE: 'ACTIVE',
    FAILED: 'FAILED',
  },
  GoogleAIFileManager: jest.fn().mockImplementation(() => ({
    uploadFile: jest.fn().mockResolvedValue({
      file: {
        name: 'files/abc',
        uri: 'https://files.gemini/abc',
        mimeType: 'video/mp4',
      },
    }),
    getFile: jest.fn().mockResolvedValue({ state: 'ACTIVE' }),
  })),
}));

jest.mock('fs/promises', () => ({
  writeFile: jest.fn().mockResolvedValue(undefined),
  unlink: jest.fn().mockResolvedValue(undefined),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

import { uploadVideoToGemini } from '@/lib/videoProcessor';

describe('uploadVideoToGemini', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
    mockFetch.mockResolvedValue({
      ok: true,
      arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)),
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('returns fileUri and mimeType on success', async () => {
    const result = await uploadVideoToGemini('https://example.com/video.mp4');
    expect(result.fileUri).toBe('https://files.gemini/abc');
    expect(result.mimeType).toBe('video/mp4');
  });

  it('throws if video download fails', async () => {
    mockFetch.mockResolvedValue({ ok: false });
    await expect(uploadVideoToGemini('https://bad.url/video.mp4')).rejects.toThrow(
      'Failed to download video'
    );
  });
});
