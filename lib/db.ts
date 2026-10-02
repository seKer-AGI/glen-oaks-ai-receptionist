import { Pool, types } from "pg";

// Return DATE columns (OID 1082) as "YYYY-MM-DD" strings instead of timezone-shifted JS Dates.
types.setTypeParser(1082, (v: string) => v);
import { env } from "./config";

/** Minimal surface we need, so tests can swap in an in-memory Postgres. */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS appointment_requests (
    id             SERIAL PRIMARY KEY,
    full_name      TEXT NOT NULL,
    address        TEXT NOT NULL,
    phone          TEXT NOT NULL,
    preferred_date TEXT NOT NULL,
    reason         TEXT NOT NULL,
    location       TEXT CHECK (location IS NULL OR location IN ('Glen Oaks', 'Jamaica')),
    status         TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'completed', 'cancelled')),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  // Existing databases created with DATE: convert so free-text dates are allowed. No-op otherwise.
  `ALTER TABLE appointment_requests ALTER COLUMN preferred_date TYPE TEXT USING preferred_date::text`,
  `CREATE INDEX IF NOT EXISTS idx_requests_status ON appointment_requests (status)`,
  `CREATE INDEX IF NOT EXISTS idx_requests_created ON appointment_requests (created_at)`,
  `CREATE TABLE IF NOT EXISTS call_transcripts (
    session_id  TEXT PRIMARY KEY,
    transcript  JSONB NOT NULL DEFAULT '[]',
    request_ids JSONB NOT NULL DEFAULT '[]',
    started_at  TIMESTAMPTZ NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL
  )`,
];

const g = globalThis as unknown as {
  __pool?: Queryable;
  __schemaReady?: Promise<void>;
};

function createPool(): Pool {
  // Uses DATABASE_URL if set, otherwise the standard PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE variables.
  const url = env.databaseUrl();
  return new Pool(url ? { connectionString: url, max: 10 } : { max: 10 });
}

export async function ensureSchema(pool: Queryable): Promise<void> {
  for (const stmt of SCHEMA) {
    try {
      await pool.query(stmt);
    } catch (err) {
      if (!stmt.startsWith("ALTER TABLE")) throw err; // the migration is best-effort
    }
  }
}

/** Returns the shared connection pool, creating the tables on first use. */
export async function getDb(): Promise<Queryable> {
  const pool = (g.__pool ??= createPool());
  g.__schemaReady ??= ensureSchema(pool).catch((err) => {
    g.__schemaReady = undefined; // retry on the next call
    throw err;
  });
  await g.__schemaReady;
  return pool;
}

/** Test helper: swap the shared connection (pass undefined to reset). */
export function setDb(pool: Queryable | undefined): void {
  g.__pool = pool;
  g.__schemaReady = undefined;
}
