const mockGenerateContent = jest.fn();
const mockGetGenerativeModel = jest.fn().mockReturnValue({
  generateContent: mockGenerateContent,
});

jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  })),
}));

import { processRecipe } from '@/lib/gemini';

describe('processRecipe', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key';
    delete process.env.GEMINI_MODEL;
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

  it('falls back to another model when the primary model is unavailable', async () => {
    mockGenerateContent
      .mockRejectedValueOnce(
        Object.assign(new Error('model is no longer available'), { status: 404 })
      )
      .mockResolvedValueOnce({
        response: { text: () => '<html><body><h1>Fallback Model</h1></body></html>' },
      });

    const result = await processRecipe('fallback caption');
    expect(result.title).toBe('Fallback Model');
    expect(mockGetGenerativeModel).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ model: 'gemini-2.5-flash' })
    );
    expect(mockGetGenerativeModel).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ model: 'gemini-flash-latest' })
    );
  });

  it('injects a shortcuts reminder button with all ingredients', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () =>
          '<!DOCTYPE html><html><body><h1>Tacos</h1><h2>Ingredients</h2><ul><li>1 lb beef</li><li>2 tortillas</li></ul></body></html>',
      },
    });

    const result = await processRecipe('taco caption');
    expect(result.html).toContain('Add Ingredients To Reminders');
    expect(result.html).toContain('shortcuts://run-shortcut');
    expect(result.html).toContain(
      encodeURIComponent('Tacos:\n- 1 lb beef\n- 2 tortillas')
    );
  });
});
