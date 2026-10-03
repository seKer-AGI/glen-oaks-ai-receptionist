import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

async function main() {
  const { getDb } = await import("../lib/db");
  const { ensureDemoAppointmentRequest } = await import("../lib/demoAppointment");
  const db = await getDb();
  await ensureDemoAppointmentRequest();
  const r = await db.query("SELECT current_database() AS db, (SELECT COUNT(*) FROM appointment_requests) AS n");
  console.log(`Connected to PostgreSQL database "${r.rows[0].db}". Tables ready (${r.rows[0].n} appointment requests).`);
  process.exit(0);
}

main().catch((e) => {
  console.error("Database connection failed:", e.message);
  process.exit(1);
});
