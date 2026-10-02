import { PRACTICE_NAME, SPOKEN } from "./config";
import { createAppointmentRequest, saveTranscript, type AppointmentRequest } from "./appointments";
import { isEmergency } from "./emergency";
import { formatContext, getKnowledgeBase, type KnowledgeBase } from "./knowledge";
import { cleanSpeech, enforceResponseLength } from "./responseLength";
import type { CallSession } from "./session";
import {
  APPOINTMENT_FIELDS,
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
}

export interface Deps {
  llm: LlmClient;
  kb?: KnowledgeBase;
  now?: () => Date;
  saveRequest?: (input: Record<string, string | null | undefined>) => Promise<AppointmentRequest>;
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
        phone: { type: "string", description: "Phone number as spoken." },
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
    text, saved: [], changed: [], problems: [], corrected: false, cancelled: false, ...extra,
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
  for (const f of APPOINTMENT_FIELDS) {
    const v = args[f];
    if (typeof v !== "string" || !v.trim()) continue;
    const r = validateField(f, v, now);
    if (r.ok) {
      if (session.appointment[f] !== r.value) {
        changed.push(f);
        if (session.appointment[f]) corrected = true;
      }
      session.appointment[f] = r.value;
      saved.push(f);
    } else {
      delete session.appointment[f];
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
  return outcome(parts.filter(Boolean).join(" "), { saved, changed, problems, corrected });
}

const ACKS = ["Thank you.", "Got it.", "Perfect."];

/**
 * Fast path: when the patient just answered a question cleanly, the server writes the
 * acknowledgement and next question itself, which saves a second LLM round trip.
 */
function quickBookingReply(session: CallSession, o: UpdateOutcome): string | null {
  const next = missingFields(session)[0];
  if (!session.booking || !next || o.problems.length || o.saved.length === 0) return null;
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

async function persist(session: CallSession): Promise<void> {
  try {
    await saveTranscript(session.id, session.startedAt, session.transcript, session.requestIds);
  } catch {
    // Transcript storage is best-effort and must never break the call.
  }
}

export function appointmentSnapshot(session: CallSession) {
  const a = session.appointment;
  return {
    booking: session.booking,
    fields: {
      full_name: a.full_name ?? null,
      address: a.address ?? null,
      phone: a.phone ?? null,
      preferred_date: a.preferred_date ?? null,
      reason: a.reason ?? null,
    },
    location: session.location,
    savedIds: session.requestIds,
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
  await persist(session);
  return result;
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

  if (!session.booking && BOOKING_INTENT_RE.test(text) && !NOT_BOOKING_RE.test(text)) {
    session.booking = true;
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

  let resp = await deps.llm.complete({
    messages,
    tools: [APPOINTMENT_TOOL],
    toolChoice: session.booking ? "required" : "auto",
  });

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
    if (session.booking && missingFields(session).length === 0) break;
    if (resp.toolCalls.length === 1 && last && (quick = quickBookingReply(session, last))) break;
    resp = await deps.llm.complete({ messages, tools: [APPOINTMENT_TOOL], toolChoice: "none" });
  }
  if (quick) return { reply: quick };

  // Deterministic completion: save once all five validated fields are present.
  if (session.booking && missingFields(session).length === 0) {
    try {
      const save = deps.saveRequest ?? ((i) => createAppointmentRequest(i, now));
      const saved = await save({ ...session.appointment, location: session.location });
      session.requestIds.push(saved.id);
      session.booking = false;
      session.appointment = {};
      session.location = null;
      return { reply: SPOKEN.completed, saved };
    } catch (err) {
      console.error("[receptionist] save failed:", err instanceof Error ? err.name : "unknown");
      return { reply: SPOKEN.dbError };
    }
  }

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
