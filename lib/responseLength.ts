import { MAX_RESPONSE_WORDS } from "./config";

export interface LengthCheck {
  valid: boolean;
  wordCount: number;
  max: number;
}

export function cleanSpeech(text: string): string {
  return text
    .replace(/[*_`#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function countWords(text: string): number {
  const t = cleanSpeech(text);
  return t ? t.split(" ").length : 0;
}

export function validateResponseLength(
  response: string,
  max: number = MAX_RESPONSE_WORDS,
): LengthCheck {
  const wordCount = countWords(response);
  return { valid: wordCount > 0 && wordCount <= max, wordCount, max };
}

/** Deterministic fallback: keep whole sentences that fit, else cut at a clause, else hard-cut. */
export function shortenResponse(
  response: string,
  max: number = MAX_RESPONSE_WORDS,
): string {
  const text = cleanSpeech(response);
  if (countWords(text) <= max) return text;

  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text];
  let out = "";
  for (const s of sentences) {
    const candidate = (out ? out + " " : "") + s.trim();
    if (countWords(candidate) > max) break;
    out = candidate;
  }
  if (out) return out;

  const first = sentences[0].trim();
  const clauses = first.split(/,\s*/);
  let clause = "";
  for (const c of clauses) {
    const candidate = clause ? `${clause}, ${c}` : c;
    if (countWords(candidate) > max) break;
    clause = candidate;
  }
  const base = clause || first.split(" ").slice(0, max).join(" ");
  return base.replace(/[,;:]+$/, "").replace(/[.!?]*$/, "") + ".";
}

/**
 * Guarantees the returned text is <= max words.
 * Tries `regenerate` (an LLM rewrite) up to `retries` times, then falls back to shortenResponse.
 */
export async function enforceResponseLength(
  response: string,
  regenerate?: (tooLong: string, wordCount: number) => Promise<string>,
  options: { max?: number; retries?: number } = {},
): Promise<string> {
  const max = options.max ?? MAX_RESPONSE_WORDS;
  const retries = options.retries ?? 2;
  let current = cleanSpeech(response);

  for (let i = 0; i < retries && !validateResponseLength(current, max).valid; i++) {
    if (!regenerate) break;
    try {
      current = cleanSpeech(await regenerate(current, countWords(current)));
    } catch {
      break;
    }
  }
  return validateResponseLength(current, max).valid
    ? current
    : shortenResponse(current, max);
}
