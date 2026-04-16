import { GoogleGenerativeAI, Part } from '@google/generative-ai';

const SYSTEM_PROMPT = `You are a recipe formatting assistant. You will receive raw text extracted from \
an Instagram post or Reel (caption, on-screen text, and/or transcribed speech). \
Extract ONLY the recipe content and format it as a clean, self-contained HTML \
document with embedded CSS.

Structure:
- Recipe title (h1)
- Servings / time metadata if present (small tag)
- Ingredients (ul)
- Instructions (ol)
- Notes / tips if present (blockquote)

Rules:
- Do NOT include any Instagram-specific text (hashtags, @mentions, CTAs, follower prompts)
- If no recipe is found, return a single paragraph: "No recipe found in this post."
- Output ONLY valid HTML. No markdown. No explanation. No code fences.
- Embed all CSS inline in a <style> tag. Make it clean, readable, mobile-friendly.`;

export interface RecipeResult {
  html: string;
  title: string;
}

const DEFAULT_MODEL_CANDIDATES = [
  'gemini-2.5-flash',
  'gemini-flash-latest',
  'gemini-2.0-flash',
];

function extractTitle(html: string): string {
  const match = html.match(/<h1[^>]*>(.*?)<\/h1>/i);
  return match ? match[1].replace(/<[^>]+>/g, '').trim() : '';
}

function stripCodeFences(text: string): string {
  return text
    .replace(/^```(?:html)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function getModelCandidates(): string[] {
  const configured = process.env.GEMINI_MODEL?.trim();
  const models = configured
    ? [configured, ...DEFAULT_MODEL_CANDIDATES]
    : [...DEFAULT_MODEL_CANDIDATES];

  return [...new Set(models.filter((model) => model.length > 0))];
}

function isModelUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const status = (error as { status?: number }).status;
  const message = error.message.toLowerCase();

  return (
    status === 404 &&
    (message.includes('no longer available') ||
      message.includes('not found') ||
      message.includes('model'))
  );
}

export async function processRecipe(
  caption: string,
  videoFileUri?: string,
  videoMimeType?: string
): Promise<RecipeResult> {
  const parts: Part[] = [];

  if (videoFileUri && videoMimeType) {
    parts.push({ fileData: { mimeType: videoMimeType, fileUri: videoFileUri } });
  }

  if (caption) {
    parts.push({ text: `Caption: ${caption}` });
  }

  if (parts.length === 0) throw new Error('No content to process');

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const modelCandidates = getModelCandidates();
  let lastModelError: unknown;

  for (const modelName of modelCandidates) {
    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: SYSTEM_PROMPT,
    });

    try {
      const result = await model.generateContent(parts);
      const html = stripCodeFences(result.response.text());
      return { html, title: extractTitle(html) };
    } catch (error) {
      if (isModelUnavailableError(error)) {
        lastModelError = error;
        continue;
      }
      throw error;
    }
  }

  if (lastModelError instanceof Error) {
    throw lastModelError;
  }

  throw new Error('No usable Gemini model found');
}
