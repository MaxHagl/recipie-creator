import { GoogleGenerativeAI, Part } from '@google/generative-ai';

const SYSTEM_PROMPT = `You are a recipe extraction + culinary QA + HTML presentation assistant.

You receive raw content from an Instagram Post/Reel (caption, possible OCR/transcript context).
Your job is to produce a polished, self-contained recipe-card HTML document and to internally verify recipe consistency before finalizing.

RECIPE EXTRACTION RULES
1) Keep only recipe-relevant content.
2) Remove Instagram noise: hashtags, @mentions, follow/share CTAs, promo lines, unrelated storytelling.
3) Normalize ambiguous shorthand where reasonable (e.g., "tsp", "tbsp", "oz", fractions).
4) If details are missing, keep language conservative and do not invent highly specific facts.
5) Input may be in English, German, or Spanish. You must correctly interpret all three.

LANGUAGE HANDLING (required)
- Always output the final recipe in English only.
- Translate ingredient names, instructions, notes, and metadata from German/Spanish to natural English.
- Convert locale-specific cooking terms to standard English kitchen terminology.
- Preserve original quantities and units unless a harmless normalization improves clarity.

CONSISTENCY / "DOUBLE CHECK" PASS (required before output)
Review the extracted recipe and correct obvious issues:
- Ingredient-to-step consistency: each key ingredient should appear in instructions.
- Portion sanity: yield/servings should not conflict with ingredient volume.
- Sequence sanity: prep before cook, sauce before assembly, etc.
- Cooking realism: temperatures/times should be plausible if present.
- Duplicates or contradictions should be resolved.
- Instructions are mandatory for every real recipe.
- If source content lacks clear steps, infer practical cooking steps from the ingredient list and dish type.
- Never return a recipe with empty/missing instructions.

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
- Instructions as an ordered list with meaningful step text (at least 3 steps when a recipe is found)
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
const INSTRUCTIONS_REPAIR_PROMPT = `The previous HTML output is missing complete recipe instructions.

Rewrite and return the full HTML recipe document with:
- a valid Ingredients section
- a valid Instructions section containing at least 3 numbered <li> steps
- coherent cooking flow that uses listed ingredients

Return ONLY full HTML. No markdown or commentary.`;
const INSTRUCTIONS_REPAIR_PROMPT_STRONG = `The recipe output still has missing/empty instructions.

Create complete, practical cooking steps from the available ingredient list and dish context.
Return a full valid HTML recipe document with a non-empty ordered Instructions list.
Minimum 3 instruction steps for a recipe.

Return ONLY full HTML.`;
const RECIPE_RECOVERY_PROMPT = `Your previous response said "No recipe found in this post."

Re-check the source carefully. If there are any food/cooking signals (ingredients, quantities, cooking actions, dish context), produce a complete best-effort recipe HTML.
Do not fail just because some values are missing. Infer practical details conservatively.

Return ONLY full HTML. No markdown or commentary.`;
const RECIPE_RECOVERY_PROMPT_STRONG = `The source still appears recipe-related.

You must return a complete recipe HTML with:
- clear title
- ingredients list
- instructions list with at least 3 steps
- estimated calories per serving

Only return "No recipe found in this post." when the source is clearly not food/cooking content.
Return ONLY full HTML.`;
const RECIPE_SIGNAL_PATTERNS = [
  /\b(recipe|ingredients?|instructions?|servings?|prep|cook|bake|fry|boil|simmer|saute|grill|mix|stir|whisk|marinate)\b/i,
  /\b(zutaten|anleitung|zubereitung|portionen|kochen|braten|backen)\b/i,
  /\b(ingredientes?|instrucciones?|porciones?|cocinar|freir|hornear|mezclar)\b/i,
  /\b\d+\s*(?:\/\s*\d+)?\s*(?:g|kg|ml|l|oz|lb|lbs|cup|cups|tbsp|tsp|teaspoons?|tablespoons?)\b/i,
  /\b(chicken|beef|pork|fish|egg|eggs|flour|sugar|salt|pepper|onion|garlic|tomato|cheese|butter|oil|rice|pasta|taco|potato|avocado|beans?)\b/i,
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

function isNoRecipeFoundHtml(html: string): boolean {
  return /no recipe found in this post/i.test(html);
}

function hasInstructionSteps(html: string): boolean {
  const instructionsSectionMatch = html.match(
    /<h[1-6][^>]*>\s*instructions?\s*<\/h[1-6]>\s*<ol[^>]*>([\s\S]*?)<\/ol>/i
  );
  const olContent =
    instructionsSectionMatch?.[1] ?? html.match(/<ol[^>]*>([\s\S]*?)<\/ol>/i)?.[1];

  if (!olContent) {
    return false;
  }

  return (olContent.match(/<li\b/gi) || []).length > 0;
}

async function ensureInstructionSteps(
  model: { generateContent: (parts: Part[]) => Promise<{ response: { text: () => string } }> },
  originalParts: Part[],
  html: string
): Promise<string> {
  if (isNoRecipeFoundHtml(html) || hasInstructionSteps(html)) {
    return html;
  }

  const repairParts: Part[] = [
    ...originalParts,
    {
      text:
        `${INSTRUCTIONS_REPAIR_PROMPT}\n\n` +
        `Previous HTML output:\n${html}`,
    },
  ];

  const repaired = stripCodeFences((await model.generateContent(repairParts)).response.text());
  if (isNoRecipeFoundHtml(repaired) || hasInstructionSteps(repaired)) {
    return repaired;
  }

  const strongerRepairParts: Part[] = [
    ...originalParts,
    {
      text:
        `${INSTRUCTIONS_REPAIR_PROMPT_STRONG}\n\n` +
        `Previous HTML output:\n${repaired}`,
    },
  ];

  return stripCodeFences(
    (await model.generateContent(strongerRepairParts)).response.text()
  );
}

function getTextParts(parts: Part[]): string {
  return parts
    .flatMap((part) =>
      'text' in part && typeof part.text === 'string' ? [part.text] : []
    )
    .join('\n');
}

function hasRecipeSignals(input: string): boolean {
  const normalized = input.trim();
  if (!normalized) {
    return false;
  }

  let score = 0;
  for (const pattern of RECIPE_SIGNAL_PATTERNS) {
    if (pattern.test(normalized)) {
      score += 1;
    }
  }

  if (
    /\b(likes?|comments?|follow|instagram|reel|share this)\b/i.test(normalized) &&
    score <= 1
  ) {
    score -= 1;
  }

  return score >= 2;
}

async function ensureRecipeRecoveredWhenRelevant(
  model: { generateContent: (parts: Part[]) => Promise<{ response: { text: () => string } }> },
  originalParts: Part[],
  html: string
): Promise<string> {
  if (!isNoRecipeFoundHtml(html)) {
    return html;
  }

  const sourceText = getTextParts(originalParts);
  if (!hasRecipeSignals(sourceText)) {
    return html;
  }

  const repairParts: Part[] = [
    ...originalParts,
    {
      text:
        `${RECIPE_RECOVERY_PROMPT}\n\n` +
        `Previous HTML output:\n${html}`,
    },
  ];

  const repaired = stripCodeFences((await model.generateContent(repairParts)).response.text());
  if (!isNoRecipeFoundHtml(repaired)) {
    return repaired;
  }

  const strongerRepairParts: Part[] = [
    ...originalParts,
    {
      text:
        `${RECIPE_RECOVERY_PROMPT_STRONG}\n\n` +
        `Previous HTML output:\n${repaired}`,
    },
  ];

  return stripCodeFences(
    (await model.generateContent(strongerRepairParts)).response.text()
  );
}

function decodeHtmlEntities(input: string): string {
  const namedEntities: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    ndash: '-',
    mdash: '-',
    hellip: '...',
    frac14: '1/4',
    frac12: '1/2',
    frac34: '3/4',
  };

  return input
    .replace(/&([a-zA-Z]+);/g, (match, entityName: string) => {
      const normalized = namedEntities[entityName.toLowerCase()];
      return normalized ?? match;
    })
    .replace(/&#(\d+);/g, (match, codePoint: string) => {
      const value = Number.parseInt(codePoint, 10);
      return Number.isNaN(value) ? match : String.fromCodePoint(value);
    })
    .replace(/&#x([\da-fA-F]+);/g, (match, hexCodePoint: string) => {
      const value = Number.parseInt(hexCodePoint, 16);
      return Number.isNaN(value) ? match : String.fromCodePoint(value);
    });
}

function toPlainText(htmlFragment: string): string {
  return decodeHtmlEntities(htmlFragment)
    .replace(/[\u2012-\u2015]/g, '-')
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

function isModelOverloadedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const status = (error as { status?: number }).status;
  const message = error.message.toLowerCase();

  return (
    status === 503 ||
    message.includes('service unavailable') ||
    message.includes('high demand')
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
      const initialHtml = stripCodeFences(result.response.text());
      const recoveredHtml = await ensureRecipeRecoveredWhenRelevant(
        model,
        parts,
        initialHtml
      );
      const rawHtml = await ensureInstructionSteps(model, parts, recoveredHtml);
      const title = extractTitle(rawHtml);
      const html = injectReminderButton(rawHtml, title);
      return { html, title };
    } catch (error) {
      if (isModelUnavailableError(error) || isModelOverloadedError(error)) {
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
