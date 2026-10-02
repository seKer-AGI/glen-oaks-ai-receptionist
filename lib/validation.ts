export const APPOINTMENT_FIELDS = [
  "full_name",
  "address",
  "phone",
  "preferred_date",
  "reason",
] as const;
export type AppointmentField = (typeof APPOINTMENT_FIELDS)[number];

export const LOCATIONS = ["Glen Oaks", "Jamaica"] as const;
export type Location = (typeof LOCATIONS)[number];

export interface AppointmentInput {
  full_name: string;
  address: string;
  phone: string;
  preferred_date: string;
  reason: string;
  location?: Location | null;
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const DIGIT_WORDS: Record<string, string> = {
  zero: "0", oh: "0", o: "0", one: "1", two: "2", three: "3", four: "4",
  five: "5", six: "6", seven: "7", eight: "8", nine: "9",
};

const MONTHS = [
  "january", "february", "march", "april", "may", "june", "july",
  "august", "september", "october", "november", "december",
];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function validateName(raw: string): Result<string> {
  const v = raw.trim().replace(/\s+/g, " ");
  if (v.length < 2 || v.length > 80) return { ok: false, error: "name must be 2-80 characters" };
  if (!/^[\p{L}][\p{L}\s.'’-]*$/u.test(v)) return { ok: false, error: "name should contain only letters" };
  return { ok: true, value: v };
}

export function validateAddress(raw: string): Result<string> {
  const v = raw.trim().replace(/\s+/g, " ");
  if (v.length < 4 || v.length > 200) return { ok: false, error: "address must be 4-200 characters" };
  if (!/\p{L}/u.test(v)) return { ok: false, error: "address needs a street or city name" };
  return { ok: true, value: v };
}

const TEENS: Record<string, string> = {
  ten: "10", eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15",
  sixteen: "16", seventeen: "17", eighteen: "18", nineteen: "19",
};
const TENS: Record<string, string> = {
  twenty: "2", thirty: "3", forty: "4", fifty: "5", sixty: "6", seventy: "7", eighty: "8", ninety: "9",
};

/**
 * Turns what the patient said into a digit string. Handles plain digits and every common
 * spoken form: "seven one eight", "double five", "twelve thirty-four", "three hundred".
 */
function spokenDigits(raw: string): string {
  const tokens = raw.toLowerCase().split(/[\s,.\-()]+/).filter(Boolean);
  const oneDigit = (t?: string) => (t === undefined ? "" : (DIGIT_WORDS[t] ?? (/^\d$/.test(t) ? t : "")));
  let digits = "";
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1];
    if ((t === "double" || t === "triple") && oneDigit(next)) {
      digits += oneDigit(next).repeat(t === "double" ? 2 : 3);
      i++;
    } else if (TEENS[t]) {
      digits += TEENS[t];
    } else if (TENS[t]) {
      const unit = oneDigit(next);
      if (unit && unit !== "0") {
        digits += TENS[t] + unit; // "thirty four" -> 34
        i++;
      } else {
        digits += TENS[t] + "0"; // "thirty" -> 30
      }
    } else if (oneDigit(t) && next === "hundred") {
      digits += oneDigit(t) + "00"; // "three hundred" -> 300
      i++;
    } else if (t === "hundred") {
      digits += "00";
    } else {
      digits += (DIGIT_WORDS[t] ?? t).replace(/\D/g, "");
    }
  }
  return digits;
}

/**
 * Accepts any plausible phone number (US or international, 7-15 digits) and never
 * insists on a specific format. Only a genuinely unusable answer (too few digits) is rejected.
 */
export function normalizePhone(raw: string): Result<string> {
  const tokens = raw.toLowerCase().split(/[\s,.\-()]+/).filter(Boolean);
  let digits = spokenDigits(raw);
  const plus = raw.trim().startsWith("+") || tokens[0] === "plus";
  if (!plus && digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length < 7 || digits.length > 15) {
    return { ok: false, error: "phone needs at least 7 digits" };
  }
  if (!plus && digits.length === 10) {
    return { ok: true, value: `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` };
  }
  return { ok: true, value: (plus ? "+" : "") + digits };
}

export function validateReason(raw: string): Result<string> {
  const v = raw.trim().replace(/\s+/g, " ");
  if (v.length < 3 || v.length > 300) return { ok: false, error: "reason must be 3-300 characters" };
  if (!/\p{L}/u.test(v)) return { ok: false, error: "reason needs some words" };
  return { ok: true, value: v };
}

function iso(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

function startOfDay(now: Date): Date {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

/** Accepts ISO dates, "October 10th", "10/10", "tomorrow", "next Monday", etc. Returns YYYY-MM-DD. */
export function parsePreferredDate(raw: string, now: Date = new Date()): Result<string> {
  const text = raw.trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, "$1").replace(/,/g, " ");
  const today = startOfDay(now);
  const bad = (error: string): Result<string> => ({ ok: false, error });
  const notPast = (d: string | null): Result<string> => {
    if (!d) return bad("that is not a real calendar date");
    if (new Date(d + "T00:00:00Z") < today) return bad("that date is in the past");
    return { ok: true, value: d };
  };
  const addDays = (n: number) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  let m = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return notPast(iso(+m[1], +m[2], +m[3]));

  if (/\btoday\b/.test(text)) return { ok: true, value: addDays(0) };
  if (/\btomorrow\b/.test(text)) return { ok: true, value: addDays(1) };

  if (/\bnext week\b/.test(text)) return { ok: true, value: addDays(7) };
  if (/\bday after tomorrow\b/.test(text)) return { ok: true, value: addDays(2) };
  const dayOnly = text.match(/^(?:the\s+)?(\d{1,2})$/);
  if (dayOnly) {
    const day = +dayOnly[1];
    let res = iso(today.getUTCFullYear(), today.getUTCMonth() + 1, day);
    if (!res || new Date(res + "T00:00:00Z") < today) {
      const nm = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
      res = iso(nm.getUTCFullYear(), nm.getUTCMonth() + 1, day);
    }
    return notPast(res);
  }

  const wd = WEEKDAYS.findIndex((w) => new RegExp(`\\b${w}\\b`).test(text));
  if (wd >= 0) {
    let diff = (wd - today.getUTCDay() + 7) % 7;
    if (diff === 0) diff = 7;
    return { ok: true, value: addDays(diff) };
  }

  // Resolves a month/day to the next occurrence if no year given.
  const withYear = (mo: number, d: number, y?: number): Result<string> => {
    if (y !== undefined) return notPast(iso(y < 100 ? 2000 + y : y, mo, d));
    let res = iso(today.getUTCFullYear(), mo, d);
    if (res && new Date(res + "T00:00:00Z") < today) res = iso(today.getUTCFullYear() + 1, mo, d);
    return notPast(res);
  };

  m = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (m) return withYear(+m[1], +m[2], m[3] ? +m[3] : undefined);

  const monthRe = MONTHS.map((x) => x.slice(0, 3) + "[a-z]*").join("|");
  m = text.match(new RegExp(`\\b(${monthRe})\\s+(\\d{1,2})(?:\\s+(\\d{4}))?\\b`));
  if (m) {
    const mo = MONTHS.findIndex((x) => x.startsWith(m![1].slice(0, 3))) + 1;
    return withYear(mo, +m[2], m[3] ? +m[3] : undefined);
  }
  m = text.match(new RegExp(`\\b(\\d{1,2})\\s+(?:of\\s+)?(${monthRe})(?:\\s+(\\d{4}))?\\b`));
  if (m) {
    const mo = MONTHS.findIndex((x) => x.startsWith(m![2].slice(0, 3))) + 1;
    return withYear(mo, +m[1], m[3] ? +m[3] : undefined);
  }
  return bad("could not understand that date; ask for a specific day");
}

/** A date we could not parse (e.g. "sometime next month") is still kept as the patient's own words. */
export function isFreeTextDate(raw: string): boolean {
  const v = raw.trim();
  return v.length >= 3 && v.length <= 80 && /[\p{L}\d]/u.test(v);
}

export function validateLocation(raw: string | null | undefined): Location | null {
  if (!raw) return null;
  const t = raw.toLowerCase();
  if (t.includes("glen")) return "Glen Oaks";
  if (t.includes("jamaica")) return "Jamaica";
  return null;
}

export function validateField(
  field: AppointmentField,
  raw: string,
  now: Date = new Date(),
): Result<string> {
  switch (field) {
    case "full_name": return validateName(raw);
    case "address": return validateAddress(raw);
    case "phone": return normalizePhone(raw);
    case "preferred_date": return parsePreferredDate(raw, now);
    case "reason": return validateReason(raw);
  }
}

export function validateAppointmentInput(
  input: Partial<Record<AppointmentField | "location", string | null | undefined>>,
  now: Date = new Date(),
): { ok: true; value: AppointmentInput } | { ok: false; errors: Partial<Record<AppointmentField, string>> } {
  const errors: Partial<Record<AppointmentField, string>> = {};
  const out: Partial<AppointmentInput> = {};
  for (const f of APPOINTMENT_FIELDS) {
    const raw = input[f];
    if (!raw || !String(raw).trim()) {
      errors[f] = "required";
      continue;
    }
    const r = validateField(f, String(raw), now);
    if (r.ok) out[f] = r.value;
    else if (f === "preferred_date" && isFreeTextDate(String(raw))) out[f] = String(raw).trim().replace(/\s+/g, " ");
    else errors[f] = r.error;
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { ...(out as AppointmentInput), location: validateLocation(input.location) } };
}
