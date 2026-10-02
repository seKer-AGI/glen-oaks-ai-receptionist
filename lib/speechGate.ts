import { MAX_RESPONSE_WORDS } from "./config";
import { cleanSpeech, countWords } from "./responseLength";

const ABBREVIATIONS = new Set(["dr", "mr", "mrs", "ms", "st", "vs", "no"]);

/** A sentence this short is held back and merged with the next phrase (avoids "Sure." as its own audio clip). */
const MIN_SENTENCE_WORDS = 3;
/** A comma/colon only ends a speakable phrase once this many words are buffered. */
const MIN_PHRASE_WORDS = 6;

function isRealBoundary(text: string, index: number, punct: string): boolean {
  const head = text.slice(0, index);
  const before = head.match(/([A-Za-z]+)$/)?.[1]?.toLowerCase();
  if (before && ABBREVIATIONS.has(before) && punct === ".") return false; // "Dr. Shah"
  if (/\d$/.test(head) && /^\s*\d/.test(text.slice(index + punct.length))) return false; // "718. 343"
  return true;
}

/** Index just past the first complete sentence in `text`, or -1 if it is not finished yet. */
export function sentenceEnd(text: string): number {
  const re = /[.!?]+(?=\s)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (isRealBoundary(text, m.index, m[0])) return m.index + m[0].length;
  }
  return -1;
}

/**
 * Index just past the first chunk that is natural to speak on its own: a sentence, or a
 * clause ending in , ; : once enough words are buffered. -1 means keep buffering.
 */
export function phraseEnd(text: string): number {
  const re = /[.!?]+(?=\s)|[,;:](?=\s)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (!isRealBoundary(text, m.index, m[0])) continue;
    const end = m.index + m[0].length;
    const words = countWords(text.slice(0, end));
    const sentence = /[.!?]/.test(m[0][0]);
    if (words >= (sentence ? MIN_SENTENCE_WORDS : MIN_PHRASE_WORDS)) return end;
  }
  return -1;
}

/**
 * Turns a token stream into speakable phrases while enforcing the word cap programmatically:
 * a phrase is released only if it still fits in the budget, and everything after the first
 * overflow is dropped. Tokens are never sent to TTS one by one.
 */
export class SpeechGate {
  private buf = "";
  private words = 0;
  private closed = false;
  readonly spoken: string[] = [];

  constructor(
    private readonly onChunk: (chunk: string) => void,
    private readonly max: number = MAX_RESPONSE_WORDS,
  ) {}

  push(delta: string): void {
    this.buf += delta;
    this.drain(false);
  }

  /** Call when the model stops (or when a tool call shows this text is not the final answer). */
  finish(flush = true): void {
    if (flush) this.drain(true);
    this.closed = true;
  }

  private drain(final: boolean): void {
    for (;;) {
      if (this.closed) return;
      const end = phraseEnd(this.buf);
      const raw = end >= 0 ? this.buf.slice(0, end) : final ? this.buf : "";
      if (!raw.trim()) {
        if (final) this.buf = "";
        return;
      }
      this.buf = this.buf.slice(raw.length);
      const chunk = cleanSpeech(raw);
      if (!chunk) continue;
      const n = countWords(chunk);
      if (this.words + n > this.max) {
        this.closed = true; // overflow: drop this and everything after it
        return;
      }
      this.words += n;
      this.spoken.push(chunk);
      this.onChunk(chunk);
    }
  }

  get text(): string {
    return this.spoken.join(" ");
  }
  get hasSpoken(): boolean {
    return this.spoken.length > 0;
  }
}
