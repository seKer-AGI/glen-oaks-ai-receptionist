import { getDb } from "./db";
import { validateAppointmentInput, type AppointmentInput } from "./validation";
import { STATUSES, type AppointmentRequest, type Status, type TranscriptEntry } from "./appointments-types";
export { STATUSES };
export type { AppointmentRequest, Status, TranscriptEntry };

export class ValidationFailure extends Error {
  constructor(public errors: Record<string, string>) {
    super("Invalid appointment request");
  }
}

const COLUMNS = `id, full_name, address, phone, preferred_date, reason,
  location, status, created_at, updated_at`;

/* eslint-disable @typescript-eslint/no-explicit-any */
function iso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

function toRequest(row: any): AppointmentRequest {
  return {
    ...row,
    id: Number(row.id),
    preferred_date: row.preferred_date instanceof Date ? row.preferred_date.toISOString().slice(0, 10) : String(row.preferred_date),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

export async function createAppointmentRequest(
  input: Partial<Record<keyof AppointmentInput, string | null | undefined>>,
  now: Date = new Date(),
): Promise<AppointmentRequest> {
  const v = validateAppointmentInput(input, now);
  if (!v.ok) throw new ValidationFailure(v.errors);
  const d = v.value;
  const db = await getDb();
  const res = await db.query(
    `INSERT INTO appointment_requests (full_name, address, phone, preferred_date, reason, location)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`,
    [d.full_name, d.address, d.phone, d.preferred_date, d.reason, d.location ?? null],
  );
  return toRequest(res.rows[0]);
}

export async function getAppointmentRequest(id: number): Promise<AppointmentRequest | undefined> {
  const db = await getDb();
  const res = await db.query(`SELECT ${COLUMNS} FROM appointment_requests WHERE id = $1`, [id]);
  return res.rows[0] ? toRequest(res.rows[0]) : undefined;
}

export async function listAppointmentRequests(
  opts: { status?: string; q?: string } = {},
): Promise<AppointmentRequest[]> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.status && (STATUSES as readonly string[]).includes(opts.status)) {
    args.push(opts.status);
    where.push(`status = $${args.length}`);
  }
  if (opts.q?.trim()) {
    args.push(`%${opts.q.trim().replace(/[%_\\]/g, "")}%`);
    const p = `$${args.length}`;
    where.push(
      `(full_name ILIKE ${p} OR address ILIKE ${p} OR phone ILIKE ${p} OR reason ILIKE ${p}
        OR COALESCE(location, '') ILIKE ${p})`,
    );
  }
  const db = await getDb();
  const res = await db.query(
    `SELECT ${COLUMNS} FROM appointment_requests ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY created_at DESC, id DESC`,
    args,
  );
  return res.rows.map(toRequest);
}

export async function updateAppointmentStatus(
  id: number,
  status: Status,
): Promise<AppointmentRequest | undefined> {
  const db = await getDb();
  const res = await db.query(
    `UPDATE appointment_requests SET status = $1, updated_at = now() WHERE id = $2 RETURNING ${COLUMNS}`,
    [status, id],
  );
  return res.rows[0] ? toRequest(res.rows[0]) : undefined;
}

export async function deleteAppointmentRequest(id: number): Promise<boolean> {
  const db = await getDb();
  const res = await db.query("DELETE FROM appointment_requests WHERE id = $1", [id]);
  return (res.rowCount ?? 0) > 0;
}

// ---- Transcripts -----------------------------------------------------------

const asJson = <T>(v: unknown): T => (typeof v === "string" ? JSON.parse(v) : (v as T));

export async function saveTranscript(
  sessionId: string,
  startedAt: string,
  transcript: TranscriptEntry[],
  requestIds: number[],
): Promise<void> {
  const db = await getDb();
  await db.query(
    `INSERT INTO call_transcripts (session_id, transcript, request_ids, started_at, updated_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (session_id) DO UPDATE
       SET transcript = EXCLUDED.transcript, request_ids = EXCLUDED.request_ids, updated_at = EXCLUDED.updated_at`,
    [sessionId, JSON.stringify(transcript), JSON.stringify(requestIds), startedAt, new Date().toISOString()],
  );
}

export async function getTranscriptForRequest(id: number): Promise<TranscriptEntry[] | null> {
  const db = await getDb();
  const res = await db.query(
    "SELECT transcript, request_ids FROM call_transcripts WHERE request_ids::text LIKE $1",
    [`%${id}%`],
  );
  for (const r of res.rows) {
    if (asJson<number[]>(r.request_ids).includes(id)) return asJson<TranscriptEntry[]>(r.transcript);
  }
  return null;
}
