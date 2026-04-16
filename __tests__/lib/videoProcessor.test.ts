const mockUploadFile = jest.fn();
const mockGetFile = jest.fn();

jest.mock('@google/generative-ai/server', () => ({
  FileState: {
    PROCESSING: 'PROCESSING',
    ACTIVE: 'ACTIVE',
    FAILED: 'FAILED',
  },
  GoogleAIFileManager: jest.fn().mockImplementation(() => ({
    uploadFile: mockUploadFile,
    getFile: mockGetFile,
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
    mockUploadFile.mockResolvedValue({
      file: {
        name: 'files/abc',
        uri: 'https://files.gemini/abc',
        mimeType: 'video/mp4',
      },
    });
    mockGetFile.mockResolvedValue({ state: 'ACTIVE' });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

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

  it('retries transient download failures and eventually succeeds', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)),
      });

    const result = await uploadVideoToGemini('https://example.com/video.mp4');
    expect(result.fileUri).toBe('https://files.gemini/abc');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('retries transient upload failures and eventually succeeds', async () => {
    mockUploadFile
      .mockRejectedValueOnce(
        Object.assign(new Error('upload temporarily unavailable'), { status: 503 })
      )
      .mockResolvedValueOnce({
        file: {
          name: 'files/abc',
          uri: 'https://files.gemini/abc',
          mimeType: 'video/mp4',
        },
      });

    const result = await uploadVideoToGemini('https://example.com/video.mp4');
    expect(result.fileUri).toBe('https://files.gemini/abc');
    expect(mockUploadFile).toHaveBeenCalledTimes(2);
  });

  it('retries file readiness checks and succeeds after transient error', async () => {
    mockGetFile
      .mockRejectedValueOnce(new Error('temporary network issue while polling status'))
      .mockResolvedValueOnce({ state: 'ACTIVE' });

    const result = await uploadVideoToGemini('https://example.com/video.mp4');
    expect(result.fileUri).toBe('https://files.gemini/abc');
    expect(mockGetFile).toHaveBeenCalledTimes(2);
  });

  it('fails with clear error after upload retries are exhausted', async () => {
    mockUploadFile.mockRejectedValue(
      Object.assign(new Error('upload temporarily unavailable'), { status: 503 })
    );

    await expect(uploadVideoToGemini('https://example.com/video.mp4')).rejects.toThrow(
      'upload temporarily unavailable'
    );
    expect(mockUploadFile).toHaveBeenCalledTimes(3);
  });
});
