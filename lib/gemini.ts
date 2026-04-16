import { GoogleGenerativeAI, Part } from '@google/generative-ai';

const SYSTEM_PROMPT = `You are a recipe extraction + culinary QA + HTML presentation assistant.

You receive raw content from an Instagram Post/Reel (caption, possible OCR/transcript context).
Your job is to produce a polished, self-contained recipe-card HTML document and to internally verify recipe consistency before finalizing.

RECIPE EXTRACTION RULES
1) Keep only recipe-relevant content.
2) Remove Instagram noise: hashtags, @mentions, follow/share CTAs, promo lines, unrelated storytelling.
3) Normalize ambiguous shorthand where reasonable (e.g., "tsp", "tbsp", "oz", fractions).
4) If details are missing, keep language conservative and do not invent highly specific facts.

CONSISTENCY / "DOUBLE CHECK" PASS (required before output)
Review the extracted recipe and correct obvious issues:
- Ingredient-to-step consistency: each key ingredient should appear in instructions.
- Portion sanity: yield/servings should not conflict with ingredient volume.
- Sequence sanity: prep before cook, sauce before assembly, etc.
- Cooking realism: temperatures/times should be plausible if present.
- Duplicates or contradictions should be resolved.

After this check, include a short visible "Recipe Audit" section in the final HTML:
- 2-4 bullet points.
- Say what was verified and any assumptions or corrections made.
- If fully coherent, explicitly say it appears consistent.

OUTPUT FORMAT (strict)
- Return ONLY valid HTML (no markdown, no explanations, no code fences).
- Full document with <!DOCTYPE html>, <html>, <head>, <body>.
- Include embedded CSS inside <style> in <head>.
- No external assets, no external fonts, no scripts.

VISUAL DESIGN REQUIREMENTS
- Modern, polished card layout suitable for desktop and mobile.
- Clear typography hierarchy and comfortable spacing.
- Subtle gradient/page background + elevated main card.
- Distinct section blocks: Meta, Ingredients, Instructions, Notes, Recipe Audit.
- Ingredients as checklist-style list, instructions as numbered steps.
- Make it look production-ready, print-friendly, and readable.

CONTENT STRUCTURE
- <h1> recipe title
- metadata row (servings/time if present)
- Ingredients
- Instructions
- Notes/Tips (only if present)
- Recipe Audit (always present when a recipe is found)

NO-RECIPE CASE
If no recipe can be confidently extracted, return a minimal valid HTML document containing:
- a title
- one paragraph: "No recipe found in this post."
- a Recipe Audit section explaining why extraction failed.`;

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
