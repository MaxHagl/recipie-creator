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

Do this QA pass internally. Apply fixes directly in the recipe output.
Do NOT include audit notes, QA commentary, assumptions, or correction logs in the final HTML.

CALORIE ESTIMATION (required)
- Always calculate estimated total calories and calories per serving using explicit ingredient math.
- Use standard nutritional reference values (USDA-style values) for each ingredient quantity (e.g., kcal per 100g, per tbsp, per piece).
- Perform arithmetic: ingredient calories -> summed total -> divide by servings.
- Do not output a calorie number without doing this ingredient-level calculation.
- If servings are given as a range, output calories per serving as a range.
- If an ingredient amount is missing/ambiguous, use a conservative standard assumption and still compute.
- Keep this brief in final output: include only the final calorie estimate line, not the full worksheet.

OUTPUT FORMAT (strict)
- Return ONLY valid HTML (no markdown, no explanations, no code fences).
- Full document with <!DOCTYPE html>, <html>, <head>, <body>.
- Include embedded CSS inside <style> in <head>.
- No external assets, no external fonts, no scripts.

VISUAL DESIGN REQUIREMENTS
- Modern, polished card layout suitable for desktop and mobile.
- Clear typography hierarchy and comfortable spacing.
- Subtle gradient/page background + elevated main card.
- Distinct section blocks: Meta, Ingredients, Instructions, Notes.
- Ingredients as checklist-style list, instructions as numbered steps.
- Make it look production-ready, print-friendly, and readable.

CONTENT STRUCTURE
- <h1> recipe title
- metadata row (servings/time if present) that MUST include an estimated calories per serving value
- Ingredients
- Instructions
- Notes/Tips (only if present)

NO-RECIPE CASE
If no recipe can be confidently extracted, return a minimal valid HTML document containing:
- a title
- one paragraph: "No recipe found in this post."`;

export interface RecipeResult {
  html: string;
  title: string;
}

const DEFAULT_SHORTCUT_NAME = 'AddHTMLTask';
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

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function toPlainText(htmlFragment: string): string {
  return decodeHtmlEntities(htmlFragment)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractIngredients(html: string): string[] {
  const ingredientsSectionMatch = html.match(
    /<h[1-6][^>]*>\s*ingredients?\s*<\/h[1-6]>\s*<ul[^>]*>([\s\S]*?)<\/ul>/i
  );
  const ulContent =
    ingredientsSectionMatch?.[1] ?? html.match(/<ul[^>]*>([\s\S]*?)<\/ul>/i)?.[1];

  if (!ulContent) {
    return [];
  }

  const items = Array.from(ulContent.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi))
    .map((match) => toPlainText(match[1]))
    .filter(Boolean);

  return items;
}

function buildReminderButtonHtml(title: string, ingredients: string[]): string {
  const shortcutName = (
    process.env.SHOPPING_SHORTCUT_NAME?.trim() || DEFAULT_SHORTCUT_NAME
  ).trim();
  const listTitle = title || 'Recipe Ingredients';
  const reminderText = `${listTitle}:\n${ingredients
    .map((ingredient) => `- ${ingredient}`)
    .join('\n')}`;
  const href =
    `shortcuts://run-shortcut?name=${encodeURIComponent(shortcutName)}` +
    `&input=text&text=${encodeURIComponent(reminderText)}`;

  return `
<div class="reminder-action" style="margin:12px 0 20px;">
  <a
    href="${href}"
    style="display:inline-block;padding:10px 14px;border-radius:999px;background:#111827;color:#ffffff;text-decoration:none;font:600 14px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"
  >
    Add Ingredients To Reminders
  </a>
  <p style="margin:8px 0 0;color:#6b7280;font:500 12px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    iPhone Shortcuts required.
  </p>
</div>`;
}

function injectReminderButton(html: string, title: string): string {
  if (html.includes('shortcuts://run-shortcut')) {
    return html;
  }

  const ingredients = extractIngredients(html);
  if (ingredients.length === 0) {
    return html;
  }

  const reminderButton = buildReminderButtonHtml(title, ingredients);

  if (/<\/h1>/i.test(html)) {
    return html.replace(/<\/h1>/i, `</h1>${reminderButton}`);
  }

  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body[^>]*>/i, (match) => `${match}${reminderButton}`);
  }

  return `${reminderButton}${html}`;
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
      const rawHtml = stripCodeFences(result.response.text());
      const title = extractTitle(rawHtml);
      const html = injectReminderButton(rawHtml, title);
      return { html, title };
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
