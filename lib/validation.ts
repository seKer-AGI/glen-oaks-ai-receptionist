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

export function normalizePhone(raw: string): Result<string> {
  const words = raw.toLowerCase().split(/[\s,.-]+/).map((w) => DIGIT_WORDS[w] ?? w);
  let digits = words.join("").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return { ok: false, error: "phone must have 10 digits" };
  if (/^[01]/.test(digits)) return { ok: false, error: "phone area code is not valid" };
  return { ok: true, value: `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` };
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
    else errors[f] = r.error;
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { ...(out as AppointmentInput), location: validateLocation(input.location) } };
}
