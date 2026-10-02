import { PRACTICE_NAME, SPOKEN } from "./config";
import { createAppointmentRequest, saveTranscript, type AppointmentRequest } from "./appointments";
import { directAnswer, isPlainAttempt } from "./directAnswer";
import { isEmergency } from "./emergency";
import { formatContext, getKnowledgeBase, type KnowledgeBase } from "./knowledge";
import { cleanSpeech, enforceResponseLength } from "./responseLength";
import { SpeechGate } from "./speechGate";
import type { CallSession } from "./session";
import {
  APPOINTMENT_FIELDS,
  isFreeTextDate,
  validateField,
  validateLocation,
  type AppointmentField,
} from "./validation";

// ---- LLM abstraction (real implementation in lib/openai.ts, fakes in tests) ----

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}
export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}
export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}
export interface LlmRequest {
  messages: LlmMessage[];
  tools?: ToolDef[];
  toolChoice?: "auto" | "required" | "none";
}
export interface LlmResponse {
  content: string | null;
  toolCalls: ToolCall[];
}
export interface LlmClient {
  complete(req: LlmRequest): Promise<LlmResponse>;
  /** Optional: same as complete() but reports text tokens as they are generated. */
  completeStream?(req: LlmRequest, onText: (delta: string) => void): Promise<LlmResponse>;
}

export interface Deps {
  llm: LlmClient;
  kb?: KnowledgeBase;
  now?: () => Date;
  saveRequest?: (input: Record<string, string | null | undefined>) => Promise<AppointmentRequest>;
  /** Raw reply text as it streams in (for on-screen display). */
  onText?: (partial: string) => void;
  /** A whole sentence that is approved (within the word cap) and can be spoken immediately. */
  onSpeak?: (sentence: string) => void;
  /** Appointment details changed; push a fresh snapshot to the UI. */
  onState?: () => void;
}

export interface TurnResult {
  reply: string;
  saved?: AppointmentRequest;
}

// ---- Appointment tool ----------------------------------------------------------

const FIELD_QUESTIONS: Record<AppointmentField, string> = {
  full_name: "May I have your full name?",
  address: "What's your address?",
  phone: "What's the best phone number?",
  preferred_date: "What date would you prefer?",
  reason: "And what's the reason for your visit?",
};

export const APPOINTMENT_TOOL: ToolDef = {
  type: "function",
  function: {
    name: "update_appointment",
    description:
      "Record appointment-request details the patient just gave, or change the booking state. Call every turn while collecting an appointment, even with no new details.",
    parameters: {
      type: "object",
      properties: {
        wants_appointment: {
          type: "boolean",
          description: "True when the patient wants to book/schedule/request an appointment.",
        },
        cancel_request: {
          type: "boolean",
          description: "True when the patient says never mind / cancel the appointment request.",
        },
        full_name: { type: "string", description: "Patient's full name as spoken." },
        address: { type: "string", description: "Patient's home/mailing address as spoken." },
        phone: {
          type: "string",
          description: "Phone number exactly as the patient said it. Any format or country is fine; do not reformat or ask them to repeat it.",
        },
        preferred_date: {
          type: "string",
          description: "Preferred date. Use YYYY-MM-DD when the date is clear, otherwise the spoken text.",
        },
        reason: { type: "string", description: "Reason for the visit." },
        location: {
          type: "string",
          enum: ["Glen Oaks", "Jamaica"],
          description:
            "ONLY if the patient says which of our offices they want to visit. Never infer from their home address.",
        },
      },
    },
  },
};

export function missingFields(session: CallSession): AppointmentField[] {
  return APPOINTMENT_FIELDS.filter((f) => !session.appointment[f]);
}

function describeNext(session: CallSession): string {
  const missing = missingFields(session);
  if (!missing.length) return "All five details collected.";
  return `Next, ask ONLY this one question: "${FIELD_QUESTIONS[missing[0]]}" (still missing: ${missing.join(", ")}).`;
}

export interface UpdateOutcome {
  /** Text handed back to the LLM as the tool result. */
  text: string;
  saved: AppointmentField[];
  problems: string[];
  /** Fields the patient gave that could not be understood (and were not kept). */
  failed: AppointmentField[];
  /** Fields whose stored value actually changed. */
  changed: AppointmentField[];
  /** True when a field that already had a value was replaced. */
  corrected: boolean;
  cancelled: boolean;
}

export function applyAppointmentUpdate(
  session: CallSession,
  rawArgs: string,
  now: Date,
): UpdateOutcome {
  const outcome = (text: string, extra: Partial<UpdateOutcome> = {}): UpdateOutcome => ({
    text, saved: [], failed: [], changed: [], problems: [], corrected: false, cancelled: false, ...extra,
  });
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(rawArgs || "{}");
  } catch {
    return outcome("Could not read arguments. " + describeNext(session));
  }
  if (args.cancel_request === true) {
    session.booking = false;
    session.appointment = {};
    session.location = null;
    return outcome(
      "Appointment request cancelled. Acknowledge briefly and ask if there is anything else.",
      { cancelled: true },
    );
  }
  if (args.wants_appointment === true) session.booking = true;

  const saved: AppointmentField[] = [];
  const problems: string[] = [];
  let corrected = false;
  const changed: AppointmentField[] = [];
  const failed: AppointmentField[] = [];
  for (const f of APPOINTMENT_FIELDS) {
    const v = args[f];
    if (typeof v !== "string" || !v.trim()) continue;
    let r = validateField(f, v, now);
    if (!r.ok) {
      // Never let one field block the call: after a second failed try, keep what the patient said.
      const tries = (session.attempts[f] = (session.attempts[f] ?? 0) + 1);
      const text = v.trim().replace(/\s+/g, " ");
      if (tries >= 2 && (f === "preferred_date" ? isFreeTextDate(text) : text.length >= 2)) {
        // A "phone number" without digits is not worth storing; let the conversation move on.
        r = { ok: true, value: f === "phone" && text.replace(/\D/g, "").length < 3 ? "Not provided" : text };
      }
    }
    if (r.ok) {
      if (session.appointment[f] !== r.value) {
        changed.push(f);
        if (session.appointment[f]) corrected = true;
      }
      session.appointment[f] = r.value;
      saved.push(f);
    } else {
      delete session.appointment[f];
      failed.push(f);
      problems.push(`${f}: ${r.error}`);
    }
  }
  const loc = typeof args.location === "string" ? validateLocation(args.location) : null;
  if (loc) session.location = loc;

  const parts = [
    saved.length ? `Saved: ${saved.join(", ")}.` : "",
    problems.length ? `Not accepted (ask the patient to repeat that one detail): ${problems.join("; ")}.` : "",
    describeNext(session),
  ];
  return outcome(parts.filter(Boolean).join(" "), { saved, failed, changed, problems, corrected });
}

const ACKS = ["Thank you.", "Got it.", "Perfect."];

/** Polite, never-lecturing re-ask used when an answer genuinely could not be understood. */
export const REPEAT_PROMPTS: Record<AppointmentField, string> = {
  full_name: "Sorry, could you repeat your full name?",
  address: "Sorry, could you repeat your address?",
  phone: "Sorry, could you repeat your phone number?",
  preferred_date: "Sorry, what date works for you?",
  reason: "Sorry, could you repeat the reason for your visit?",
};

/**
 * Fast path: when the patient just answered a question cleanly, the server writes the
 * acknowledgement and next question itself, which saves a second LLM round trip.
 */
function quickBookingReply(session: CallSession, o: UpdateOutcome): string | null {
  const next = missingFields(session)[0];
  if (session.booking && o.failed.length) return REPEAT_PROMPTS[o.failed[0]];
  if (!session.booking || !next || o.problems.length || o.changed.length === 0) return null;
  const first = session.appointment.full_name?.split(" ")[0];
  let ack = ACKS[session.history.length % ACKS.length];
  if (o.changed.includes("full_name") && first) ack = o.corrected ? `No problem, ${first}.` : `Thanks, ${first}.`;
  return `${ack} ${FIELD_QUESTIONS[next]}`;
}

// ---- Prompting ------------------------------------------------------------------

function systemPrompt(session: CallSession, context: string, now: Date): string {
  const today = now.toISOString().slice(0, 10);
  const state = session.booking
    ? `APPOINTMENT MODE is ON. Collected so far: ${
        APPOINTMENT_FIELDS.filter((f) => session.appointment[f])
          .map((f) => f)
          .join(", ") || "nothing"
      }. ${describeNext(session)}`
    : "APPOINTMENT MODE is off.";

  return `You are the phone receptionist for ${PRACTICE_NAME}, a dental practice with offices in Glen Oaks and Jamaica, NY. You are speaking on a live phone call.

STYLE
- Warm, natural, professional. Usually 5-10 words. NEVER more than 20 words. One or two short sentences.
- No lists, no markdown, no emojis. Speak like a person, not a script.

FACTS
- Answer ONLY from the KNOWLEDGE below. Never invent hours, prices, doctors, insurers or policies.
- If the knowledge does not answer it, say exactly: "${SPOKEN.noInfo}"
- If asked which office or where, name Glen Oaks and Jamaica. Give an address or phone number only if asked.

SAFETY
- You are a receptionist, not a dentist. Never diagnose, interpret symptoms or x-rays, prescribe, recommend personal treatment, or guarantee results.
- "Do I have a cavity?" style questions: "Our dentist can evaluate your specific situation."
- Other medical questions: "Our dental team can help with that."

APPOINTMENTS
- When a patient wants to book, call update_appointment with wants_appointment=true, then ask for details ONE question at a time in this order: full name, address, phone number, preferred date, reason for visit.
- Collect only those five. Never ask for email, insurance, date of birth, medical history, payment or ID numbers.
- Be relaxed about answers: accept whatever the patient gives for each detail (any phone format or country, any address wording, any date wording) and move on. Never ask the patient to repeat or reformat a detail unless you truly heard nothing usable. Never explain format rules or say a detail is "invalid".
- Call update_appointment whenever the patient gives or corrects a detail. If they correct something, acknowledge it ("No problem, Michael.") and ask the next question.
- Briefly acknowledge each answer ("Thanks, John.") then ask the next question.
- If the patient asks a normal question mid-booking, answer it briefly, then return to the next question.
- NEVER say the appointment is confirmed or booked. It is only a request; the team will reach out.
- Do not announce the final thank-you yourself; the system does that when all five details are saved.

TODAY is ${today}.
${state}

KNOWLEDGE
${context || "(no relevant knowledge found for this message)"}`;
}

const HOLD_RE = /^(wait|hold on|hang on|one (moment|sec|second|minute)|just a (moment|second|sec|minute)|give me a (moment|second|sec|minute))\b[\s.!,]*(please)?[\s.!]*$/i;
const HELLO_RE = /^(hello|hi|hey|are you there|you there|hello there)\W*$/i;
const BOOKING_INTENT_RE =
  /\b(book|schedule|make|set up|request|get|need|want|like)\b.{0,30}\b(appointment|visit|consultation|checkup|cleaning)\b|\bappointment\b.{0,20}\b(please|for me)\b|\bcome in\b|\bbe seen\b/i;
const NOT_BOOKING_RE = /\b(do you|can you|are you|is there|how|what|when|walk[- ]?in)\b.*\?$/i;
const JUNK_STT_RE = /^(thanks for watching|thank you for watching|subtitles? by.*|\.+|you)\W*$/i;

export function isJunkTranscript(text: string): boolean {
  return !text.trim() || JUNK_STT_RE.test(text.trim());
}

// ---- Turn handling ----------------------------------------------------------

function record(session: CallSession, role: "patient" | "receptionist", text: string): void {
  session.transcript.push({ role, text, at: new Date().toISOString() });
}

/** Saves the transcript in the background so the database never delays the spoken reply. */
function persist(session: CallSession): Promise<void> {
  const snapshot = [...session.transcript];
  const ids = [...session.requestIds];
  const next = session.persistChain.then(() =>
    saveTranscript(session.id, session.startedAt, snapshot, ids).catch(() => undefined),
  );
  session.persistChain = next;
  return next.then(() => undefined);
}

export function appointmentSnapshot(session: CallSession) {
  const a = session.booking || !session.lastSaved ? session.appointment : session.lastSaved.fields;
  return {
    booking: session.booking,
    fields: {
      full_name: a.full_name ?? null,
      address: a.address ?? null,
      phone: a.phone ?? null,
      preferred_date: a.preferred_date ?? null,
      reason: a.reason ?? null,
    },
    location: session.booking || !session.lastSaved ? session.location : session.lastSaved.location,
    savedIds: session.requestIds,
    savedId: session.booking ? null : (session.lastSaved?.id ?? null),
  };
}

export async function greet(session: CallSession, greeting: string): Promise<string> {
  record(session, "receptionist", greeting);
  session.history.push({ role: "assistant", content: greeting });
  await persist(session);
  return greeting;
}

export async function handleSilence(session: CallSession): Promise<string> {
  session.silenceCount += 1;
  const reply = session.silenceCount === 1 ? SPOKEN.stillThere : SPOKEN.stillHere;
  record(session, "receptionist", reply);
  await persist(session);
  return reply;
}

export async function handleUnclear(session: CallSession): Promise<string> {
  record(session, "receptionist", SPOKEN.didntCatch);
  await persist(session);
  return SPOKEN.didntCatch;
}

export async function handleUserTurn(
  session: CallSession,
  userText: string,
  deps: Deps,
): Promise<TurnResult> {
  const now = (deps.now ?? (() => new Date()))();
  const text = userText.trim();
  session.silenceCount = 0;
  record(session, "patient", text);

  let result: TurnResult;
  try {
    result = await decide(session, text, deps, now);
  } catch (err) {
    console.error("[receptionist] turn failed:", err instanceof Error ? err.name : "unknown");
    result = { reply: SPOKEN.connection };
  }

  session.history.push({ role: "user", content: text }, { role: "assistant", content: result.reply });
  if (session.history.length > 24) session.history.splice(0, session.history.length - 24);
  record(session, "receptionist", result.reply);
  void persist(session);
  return result;
}

async function completeBooking(session: CallSession, deps: Deps, now: Date): Promise<TurnResult> {
  try {
    const save = deps.saveRequest ?? ((i) => createAppointmentRequest(i, now));
    const fields = { ...session.appointment } as Record<AppointmentField, string>;
    const saved = await save({ ...fields, location: session.location });
    session.requestIds.push(saved.id);
    session.lastSaved = { id: saved.id, fields, location: session.location };
    session.booking = false;
    session.appointment = {};
    session.attempts = {};
    session.location = null;
    deps.onState?.();
    return { reply: SPOKEN.completed, saved };
  } catch (err) {
    console.error("[receptionist] save failed:", err instanceof Error ? err.name : "unknown");
    return { reply: SPOKEN.dbError };
  }
}

async function decide(
  session: CallSession,
  text: string,
  deps: Deps,
  now: Date,
): Promise<TurnResult> {
  if (HOLD_RE.test(text)) return { reply: SPOKEN.hold };
  if (HELLO_RE.test(text)) return { reply: SPOKEN.here };

  const next = missingFields(session)[0];
  if (isEmergency(text) && !(session.booking && next === "reason")) {
    return { reply: SPOKEN.emergency };
  }

  const wasBooking = session.booking;
  if (!session.booking && BOOKING_INTENT_RE.test(text) && !NOT_BOOKING_RE.test(text)) {
    session.booking = true;
  }

  // Fast path: a plain answer to the question we just asked needs no LLM round trip.
  if (wasBooking && next) {
    const direct = directAnswer(next, text, now);
    if (direct) {
      const outcome = applyAppointmentUpdate(session, JSON.stringify(direct.args), now);
      deps.onState?.();
      if (missingFields(session).length === 0) return completeBooking(session, deps, now);
      const q = quickBookingReply(session, outcome);
      if (q) {
        deps.onText?.(q);
        return { reply: q };
      }
    } else if (next === "phone" && isPlainAttempt(text)) {
      // They tried to give a number but we could not read digits from it: just ask again, politely.
      const outcome = applyAppointmentUpdate(session, JSON.stringify({ phone: text }), now);
      deps.onState?.();
      const q = quickBookingReply(session, outcome);
      if (q) {
        deps.onText?.(q);
        return { reply: q };
      }
    }
  }

  const kb = deps.kb ?? getKnowledgeBase();
  const prevUser = [...session.history].reverse().find((m) => m.role === "user")?.content ?? "";
  const query = text.split(/\s+/).length <= 4 ? `${prevUser} ${text}` : text;
  const context = formatContext(kb.search(query, 3));

  const messages: LlmMessage[] = [
    { role: "system", content: systemPrompt(session, context, now) },
    ...session.history.slice(-12).map((m) => ({ role: m.role, content: m.content }) as LlmMessage),
    { role: "user", content: text },
  ];

  // Streams text to the UI as it is generated, and releases whole sentences for speech as
  // soon as they are complete (subject to the 20-word cap in SpeechGate).
  const generate = async (req: LlmRequest, mayBeFinal: boolean) => {
    const gate = new SpeechGate((sentence) => deps.onSpeak?.(sentence));
    let shown = "";
    const resp = deps.llm.completeStream
      ? await deps.llm.completeStream(req, (delta) => {
          shown += delta;
          deps.onText?.(cleanSpeech(shown));
          if (mayBeFinal) gate.push(delta);
        })
      : await deps.llm.complete(req);
    if (resp.toolCalls.length) {
      gate.finish(false); // text before a tool call is not the answer; sentences already released stay
    } else if (deps.llm.completeStream) {
      if (mayBeFinal) gate.finish(true);
    }
    return { resp, gate };
  };

  const first = await generate(
    { messages, tools: [APPOINTMENT_TOOL], toolChoice: session.booking ? "required" : "auto" },
    !session.booking,
  );
  let resp = first.resp;
  let gate = first.gate;

  let quick: string | null = null;
  for (let round = 0; resp.toolCalls.length && round < 2; round++) {
    messages.push({
      role: "assistant",
      content: resp.content,
      tool_calls: resp.toolCalls.map((c) => ({
        id: c.id,
        type: "function" as const,
        function: { name: c.name, arguments: c.arguments },
      })),
    });
    let last: UpdateOutcome | null = null;
    for (const call of resp.toolCalls) {
      last = call.name === "update_appointment" ? applyAppointmentUpdate(session, call.arguments, now) : null;
      messages.push({ role: "tool", tool_call_id: call.id, content: last?.text ?? "Unknown tool." });
    }
    deps.onState?.();
    if (session.booking && missingFields(session).length === 0) break;
    if (resp.toolCalls.length === 1 && last && (quick = quickBookingReply(session, last))) break;
    const next = await generate({ messages, tools: [APPOINTMENT_TOOL], toolChoice: "none" }, true);
    resp = next.resp;
    gate = next.gate;
  }
  if (quick) {
    deps.onText?.(quick);
    return { reply: quick };
  }

  // Deterministic completion: save once all five details are present.
  if (session.booking && missingFields(session).length === 0) return completeBooking(session, deps, now);

  // Streaming path: the gate already released (and the caller already spoke) whole sentences.
  if (gate.hasSpoken) return { reply: gate.text };

  const draft = cleanSpeech(resp.content ?? "");
  if (!draft) return { reply: SPOKEN.didntCatch };

  const reply = await enforceResponseLength(draft, async (tooLong) => {
    const r = await deps.llm.complete({
      messages: [
        {
          role: "system",
          content:
            "Rewrite this phone receptionist reply in under 15 words. Keep the meaning and the question if any. Output only the reply.",
        },
        { role: "user", content: tooLong },
      ],
    });
    return r.content ?? tooLong;
  });
  return { reply };
}
