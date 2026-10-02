import {
  normalizePhone,
  parsePreferredDate,
  validateAddress,
  validateName,
  validateReason,
  type AppointmentField,
  type Location,
} from "./validation";

/**
 * Fast path for booking: when the patient plainly answers the question we just asked,
 * extract the value without an LLM round trip. Anything unusual (questions, corrections,
 * long or ambiguous replies) returns null so the LLM handles it.
 */

const MAX_WORDS = 14;
const QUESTION_RE = /\?|^(?:do|does|can|could|would|will|what|how|where|when|why|which|who|is|are)\b/i;
const CORRECTION_RE =
  /\b(actually|sorry|wait|hold on|never ?mind|cancel|wrong|mistake|change|correct|instead|no no|not that)\b/i;
const FILLER_RE = /^(?:(?:um+|uh+|hm+|well|so|okay|ok|alright|sure|yes|yeah|yep)\b[\s,.]*)+/i;
const NOT_A_NAME = new Set(["yes", "no", "okay", "ok", "sure", "hello", "hi", "hey", "what", "huh", "why", "thanks", "please", "um", "uh", "hm", "hmm"]);

const PREFIXES: Record<AppointmentField, RegExp> = {
  full_name: /^(?:my (?:full )?name(?:'s| is)|the name is|name is|this is|it's|it is|i am|i'm|call me)\s+/i,
  address: /^(?:my (?:home |mailing )?address(?:'s| is)|the address is|address is|it's|it is|i live (?:at|in|on)|i'm (?:at|on)|i am (?:at|on)|that's|that is)\s+/i,
  phone: /^(?:my (?:phone |cell |mobile )?(?:number|phone)(?:'s| is)|the number is|number is|it's|it is|you can (?:reach|call) me at|call me at)\s+/i,
  preferred_date: /^(?:i(?:'d| would) (?:like|prefer)|i prefer|how about|let's say|can we (?:do|say)|maybe|it's|on|the date is|date is|i'm free|any time)\s+/i,
  reason: /^(?:it's|it is|it's for|it is for|for|my reason is|the reason is|reason is|i(?:'d| would) like|i want|i need|i have|just)\s+/i,
};

const OFFICE_RE = /\b(?:at|to|in|for)?\s*(?:the\s+)?(glen oaks|jamaica)\s+(?:office|location|branch|clinic)\b|\b(?:at|to)\s+(?:the\s+)?(glen oaks|jamaica)\b(?!\s*,?\s*(?:ny|new york))/i;

export interface DirectAnswer {
  args: Partial<Record<AppointmentField, string>> & { location?: Location };
}

function strip(text: string, field: AppointmentField): string {
  let t = text.trim().replace(/[.!]+$/, "").replace(/\s+please$/i, "").trim();
  t = t.replace(FILLER_RE, "").trim();
  t = t.replace(PREFIXES[field], "").trim();
  return t;
}

const CORRECTION_SPLIT_RE = /\b(?:actually|sorry|wait|no no|i mean|i meant|correction|rather|let me correct|it should be|make that)\b/i;

/** "718-555-1234... actually it's 718-555-5678": the last number that parses wins. */
function phoneAnswer(text: string): DirectAnswer | null {
  if (text.includes("?")) return null;
  const segments = text.split(CORRECTION_SPLIT_RE);
  for (let i = segments.length - 1; i >= 0; i--) {
    const v = strip(segments[i], "phone");
    if (v && normalizePhone(v).ok) return { args: { phone: v } };
  }
  return null;
}

/** True if the reply looks like an attempt to answer (short, not a question or a correction request). */
export function isPlainAttempt(text: string): boolean {
  return text.split(/\s+/).length <= MAX_WORDS && !QUESTION_RE.test(text) && !CORRECTION_RE.test(text);
}

export function directAnswer(
  field: AppointmentField,
  text: string,
  now: Date,
): DirectAnswer | null {
  if (field === "phone") return text.split(/\s+/).length > 30 ? null : phoneAnswer(text);
  if (text.split(/\s+/).length > MAX_WORDS || QUESTION_RE.test(text) || CORRECTION_RE.test(text)) return null;
  const v = strip(text, field);
  if (!v) return null;

  switch (field) {
    case "full_name": {
      if (NOT_A_NAME.has(v.toLowerCase()) || v.split(/\s+/).length > 4) return null;
      return validateName(v).ok ? { args: { full_name: v } } : null;
    }
    case "address":
      return (/\d/.test(v) || v.split(/\s+/).length >= 2) && validateAddress(v).ok ? { args: { address: v } } : null;
    case "preferred_date":
      return parsePreferredDate(v, now).ok ? { args: { preferred_date: v } } : null;
    case "reason": {
      const m = v.match(OFFICE_RE);
      const office = (m?.[1] ?? m?.[2])?.toLowerCase();
      const location: Location | undefined =
        office === "jamaica" ? "Jamaica" : office === "glen oaks" ? "Glen Oaks" : undefined;
      const reason = (m ? v.replace(OFFICE_RE, "").replace(/\s+/g, " ").replace(/[\s,]+$/, "").trim() : v) || v;
      if (!validateReason(reason).ok) return null;
      return { args: { reason, ...(location ? { location } : {}) } };
    }
  }
}
