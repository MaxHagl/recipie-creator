const mockGenerateContent = jest.fn();

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: mockGenerateContent,
    }),
  })),
}));

import { processRecipe } from '@/lib/gemini';

describe('processRecipe', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
  });

  afterEach(() => jest.clearAllMocks());

  it('returns html and extracted title', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => '<html><body><h1>Pasta Carbonara</h1></body></html>' },
    });

    const result = await processRecipe('pasta recipe caption');
    expect(result.html).toContain('<h1>Pasta Carbonara</h1>');
    expect(result.title).toBe('Pasta Carbonara');
  });

  it('strips markdown code fences from response', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => '```html\n<html><body><h1>Soup</h1></body></html>\n```',
      },
    });

    const result = await processRecipe('soup caption');
    expect(result.html).not.toContain('```');
    expect(result.title).toBe('Soup');
  });

  it('returns empty title if no h1 found', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => '<p>No recipe found in this post.</p>' },
    });

    const result = await processRecipe('random caption');
    expect(result.title).toBe('');
  });

  it('includes fileData part when videoFileUri is provided', async () => {
    mockGenerateContent.mockResolvedValue({
      response: { text: () => '<html><body><h1>Reel Recipe</h1></body></html>' },
    });

    await processRecipe('caption', 'https://files.gemini/abc', 'video/mp4');

    const callArgs = mockGenerateContent.mock.calls[0][0];
    const fileDataPart = callArgs.find((p: { fileData?: unknown }) => p.fileData);
    expect(fileDataPart).toBeDefined();
    expect(fileDataPart.fileData.fileUri).toBe('https://files.gemini/abc');
  });

  it('throws if no content is provided', async () => {
    await expect(processRecipe('')).rejects.toThrow('No content to process');
  });
});
