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
      response: {
        text: () =>
          '<html><body><h1>Pasta Carbonara</h1><h2>Instructions</h2><ol><li>Cook pasta</li></ol></body></html>',
      },
    });

    const result = await processRecipe('pasta recipe caption');
    expect(result.html).toContain('<h1>Pasta Carbonara</h1>');
    expect(result.title).toBe('Pasta Carbonara');
  });

  it('strips markdown code fences from response', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () =>
          '```html\n<html><body><h1>Soup</h1><h2>Instructions</h2><ol><li>Simmer broth</li></ol></body></html>\n```',
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
      response: {
        text: () =>
          '<html><body><h1>Reel Recipe</h1><h2>Instructions</h2><ol><li>Mix ingredients</li></ol></body></html>',
      },
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
        response: {
          text: () =>
            '<html><body><h1>Fallback Model</h1><h2>Instructions</h2><ol><li>Cook gently</li></ol></body></html>',
        },
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

  it('falls back to another model when primary model is overloaded (503)', async () => {
    mockGenerateContent
      .mockRejectedValueOnce(
        Object.assign(new Error('Service Unavailable: model high demand'), { status: 503 })
      )
      .mockResolvedValueOnce({
        response: {
          text: () =>
            '<html><body><h1>Overload Fallback</h1><h2>Instructions</h2><ol><li>Cook gently</li></ol></body></html>',
        },
      });

    const result = await processRecipe('fallback caption');
    expect(result.title).toBe('Overload Fallback');
    expect(mockGetGenerativeModel).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ model: 'gemini-2.5-flash' })
    );
    expect(mockGetGenerativeModel).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ model: 'gemini-flash-latest' })
    );
  });

  it('ignores retired gemini-2.0-flash even if configured explicitly', async () => {
    process.env.GEMINI_MODEL = 'gemini-2.0-flash';
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () =>
          '<html><body><h1>Modern Model</h1><h2>Instructions</h2><ol><li>Cook</li></ol></body></html>',
      },
    });

    const result = await processRecipe('caption');
    expect(result.title).toBe('Modern Model');
    expect(mockGetGenerativeModel).toHaveBeenCalledTimes(1);
    expect(mockGetGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-2.5-flash' })
    );
  });

  it('repairs missing instructions when model omits steps initially', async () => {
    mockGenerateContent
      .mockResolvedValueOnce({
        response: {
          text: () =>
            '<html><body><h1>Quick Pasta</h1><h2>Ingredients</h2><ul><li>200g pasta</li></ul></body></html>',
        },
      })
      .mockResolvedValueOnce({
        response: {
          text: () =>
            '<html><body><h1>Quick Pasta</h1><h2>Ingredients</h2><ul><li>200g pasta</li></ul><h2>Instructions</h2><ol><li>Boil pasta</li><li>Drain pasta</li><li>Serve</li></ol></body></html>',
        },
      });

    const result = await processRecipe('missing steps caption');
    expect(result.html).toContain('<h2>Instructions</h2>');
    expect(result.html).toContain('<li>Boil pasta</li>');
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it('retries recipe extraction when no-recipe fallback is returned despite recipe signals', async () => {
    mockGenerateContent
      .mockResolvedValueOnce({
        response: {
          text: () =>
            '<!DOCTYPE html><html><body><h1>Not found</h1><p>No recipe found in this post.</p></body></html>',
        },
      })
      .mockResolvedValueOnce({
        response: {
          text: () =>
            '<!DOCTYPE html><html><body><h1>Garlic Chicken</h1><h2>Ingredients</h2><ul><li>2 chicken thighs</li><li>1 tbsp oil</li></ul><h2>Instructions</h2><ol><li>Season chicken.</li><li>Sear in oil.</li><li>Cook through and serve.</li></ol></body></html>',
        },
      });

    const result = await processRecipe(
      'Ingredients: 2 chicken thighs, 1 tbsp oil. Cook in pan until done.'
    );

    expect(result.title).toBe('Garlic Chicken');
    expect(result.html).toContain('<h2>Instructions</h2>');
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it('retries from video input even when caption text has weak recipe signals', async () => {
    mockGenerateContent
      .mockResolvedValueOnce({
        response: {
          text: () =>
            '<!DOCTYPE html><html><body><h1>Not found</h1><p>No recipe found in this post.</p></body></html>',
        },
      })
      .mockResolvedValueOnce({
        response: {
          text: () =>
            '<!DOCTYPE html><html><body><h1>Spoken Recipe</h1><h2>Ingredients</h2><ul><li>2 eggs</li></ul><h2>Instructions</h2><ol><li>Beat eggs.</li><li>Cook in pan.</li><li>Serve warm.</li></ol></body></html>',
        },
      });

    const result = await processRecipe(
      'wow nice reel',
      'https://files.gemini/video',
      'video/mp4'
    );

    expect(result.title).toBe('Spoken Recipe');
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it('uses video-focused recovery prompt when video is provided', async () => {
    mockGenerateContent
      .mockResolvedValueOnce({
        response: {
          text: () =>
            '<!DOCTYPE html><html><body><h1>Not found</h1><p>No recipe found in this post.</p></body></html>',
        },
      })
      .mockResolvedValueOnce({
        response: {
          text: () =>
            '<!DOCTYPE html><html><body><h1>Recovered</h1><h2>Instructions</h2><ol><li>Step 1</li><li>Step 2</li><li>Step 3</li></ol></body></html>',
        },
      });

    await processRecipe('weak caption', 'https://files.gemini/video', 'video/mp4');

    const secondCallArgs = mockGenerateContent.mock.calls[1][0];
    const videoRecoveryPrompt = secondCallArgs.find(
      (part: { text?: string }) =>
        typeof part.text === 'string' &&
        part.text.includes('A reel video file is available')
    );
    expect(videoRecoveryPrompt).toBeDefined();
  });

  it('does not force retry for clearly non-recipe text', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () =>
          '<!DOCTYPE html><html><body><h1>Not found</h1><p>No recipe found in this post.</p></body></html>',
      },
    });

    const result = await processRecipe('Check out this sunset and travel clip');
    expect(result.title).toBe('Not found');
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it('injects a shortcuts reminder button with all ingredients', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () =>
          '<!DOCTYPE html><html><body><h1>Tacos</h1><h2>Ingredients</h2><ul><li>1 lb beef</li><li>2 tortillas</li></ul><h2>Instructions</h2><ol><li>Cook beef</li></ol></body></html>',
      },
    });

    const result = await processRecipe('taco caption');
    expect(result.html).toContain('Add Ingredients To Reminders');
    expect(result.html).toContain('shortcuts://run-shortcut');
    expect(result.html).toContain(
      encodeURIComponent('Tacos:\n- 1 lb beef\n- 2 tortillas')
    );
  });

  it('normalizes HTML entities in ingredients for reminders payload', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () =>
          '<!DOCTYPE html><html><body><h1>Soup</h1><h2>Ingredients</h2><ul><li>1&ndash;2 tbsp olive oil</li></ul><h2>Instructions</h2><ol><li>Heat oil</li></ol></body></html>',
      },
    });

    const result = await processRecipe('soup caption');
    expect(result.html).toContain(encodeURIComponent('Soup:\n- 1-2 tbsp olive oil'));
  });

  it('adds date-night instructions when dateNightMode is enabled', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () =>
          '<!DOCTYPE html><html><body><h1>Pasta Date Night</h1><h2>Ingredients</h2><ul><li>200g pasta</li></ul><h2>Instructions</h2><ol><li>Boil water</li><li>Cook pasta</li><li>Serve</li></ol><h2>Date Night Plan: Max + Franca</h2><h3>Max</h3><ul><li>Boil water</li></ul><h3>Franca</h3><ul><li>Prep sauce</li></ul></body></html>',
      },
    });

    await processRecipe('pasta caption', undefined, undefined, {
      dateNightMode: true,
    });

    const callArgs = mockGenerateContent.mock.calls[0][0];
    const promptPart = callArgs.find(
      (part: { text?: string }) =>
        typeof part.text === 'string' &&
        part.text.includes('DATE NIGHT MODE IS ENABLED')
    );
    expect(promptPart).toBeDefined();
  });

  it('repairs missing date-night section when enabled', async () => {
    mockGenerateContent
      .mockResolvedValueOnce({
        response: {
          text: () =>
            '<!DOCTYPE html><html><body><h1>Tacos</h1><h2>Ingredients</h2><ul><li>1 lb beef</li></ul><h2>Instructions</h2><ol><li>Cook beef</li><li>Warm tortillas</li><li>Serve</li></ol></body></html>',
        },
      })
      .mockResolvedValueOnce({
        response: {
          text: () =>
            '<!DOCTYPE html><html><body><h1>Tacos</h1><h2>Ingredients</h2><ul><li>1 lb beef</li></ul><h2>Instructions</h2><ol><li>Cook beef</li><li>Warm tortillas</li><li>Serve</li></ol><h2>Date Night Plan: Max + Franca</h2><h3>Max</h3><ul><li>Cook beef.</li><li>Handle final seasoning.</li></ul><h3>Franca</h3><ul><li>Prep toppings.</li><li>Warm tortillas.</li></ul><p>Sync: assemble together and plate at the same time.</p></body></html>',
        },
      });

    const result = await processRecipe('taco caption', undefined, undefined, {
      dateNightMode: true,
    });

    expect(result.html).toContain('Date Night Plan: Max + Franca');
    expect(result.html).toContain('Max');
    expect(result.html).toContain('Franca');
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it('keeps no-recipe output unchanged in date-night mode', async () => {
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () =>
          '<!DOCTYPE html><html><body><h1>Not found</h1><p>No recipe found in this post.</p></body></html>',
      },
    });

    const result = await processRecipe('completely unrelated text', undefined, undefined, {
      dateNightMode: true,
    });

    expect(result.html).toContain('No recipe found in this post.');
    expect(result.html).not.toContain('Date Night Plan: Max + Franca');
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });
});
