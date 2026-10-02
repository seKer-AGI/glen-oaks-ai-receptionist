import { randomUUID } from "node:crypto";
import type { TranscriptEntry } from "./appointments";
import type { AppointmentField, Location } from "./validation";

export interface CallSession {
  id: string;
  startedAt: string;
  lastActive: number;
  /** Conversation turns sent to the LLM (text only). */
  history: { role: "user" | "assistant"; content: string }[];
  transcript: TranscriptEntry[];
  booking: boolean;
  appointment: Partial<Record<AppointmentField, string>>;
  location: Location | null;
  /** How many times each field failed validation (after 2 we accept the raw text). */
  attempts: Partial<Record<AppointmentField, number>>;
  lastSaved: { id: number; fields: Record<AppointmentField, string>; location: Location | null } | null;
  /** Background transcript saves, chained so they never overlap. */
  persistChain: Promise<unknown>;
  requestIds: number[];
  silenceCount: number;
  /** Serializes turns so overlapping requests cannot interleave. */
  queue: Promise<unknown>;
}

const TTL_MS = 60 * 60 * 1000;
const g = globalThis as unknown as { __sessions?: Map<string, CallSession> };

function store(): Map<string, CallSession> {
  return (g.__sessions ??= new Map());
}

export function createSession(): CallSession {
  const now = Date.now();
  for (const [id, s] of store()) if (now - s.lastActive > TTL_MS) store().delete(id);
  const session: CallSession = {
    id: randomUUID(),
    startedAt: new Date().toISOString(),
    lastActive: now,
    history: [],
    transcript: [],
    booking: false,
    appointment: {},
    location: null,
    attempts: {},
    lastSaved: null,
    persistChain: Promise.resolve(),
    requestIds: [],
    silenceCount: 0,
    queue: Promise.resolve(),
  };
  store().set(session.id, session);
  return session;
}

export function getSession(id: string | null | undefined): CallSession | undefined {
  if (!id) return undefined;
  const s = store().get(id);
  if (s) s.lastActive = Date.now();
  return s;
}

export function endSession(id: string): void {
  store().delete(id);
}

export function runExclusive<T>(session: CallSession, fn: () => Promise<T>): Promise<T> {
  const next = session.queue.then(fn, fn);
  session.queue = next.catch(() => undefined);
  return next;
}
