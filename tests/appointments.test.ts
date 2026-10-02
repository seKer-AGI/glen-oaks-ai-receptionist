import { beforeEach, describe, expect, it } from "vitest";
import {
  ValidationFailure,
  createAppointmentRequest,
  deleteAppointmentRequest,
  getAppointmentRequest,
  getTranscriptForRequest,
  listAppointmentRequests,
  saveTranscript,
  updateAppointmentStatus,
} from "@/lib/appointments";
import { FIXED_NOW, freshDb } from "./helpers";

const base = {
  full_name: "John Smith",
  address: "123 Main Street, Queens",
  phone: "718-555-1234",
  preferred_date: "2026-10-10",
  reason: "Invisalign consultation",
};

beforeEach(async () => {
  await freshDb();
});

describe("appointment_requests (PostgreSQL)", () => {
  it("creates a request with status new and timestamps", async () => {
    const r = await createAppointmentRequest({ ...base, location: "Glen Oaks" }, FIXED_NOW);
    expect(r.id).toBeGreaterThan(0);
    expect(r.status).toBe("new");
    expect(r.location).toBe("Glen Oaks");
    expect(r.preferred_date).toBe("2026-10-10");
    expect(r.created_at).toBeTruthy();
    expect((await getAppointmentRequest(r.id))?.full_name).toBe("John Smith");
  });

  it("stores null location when none chosen", async () => {
    expect((await createAppointmentRequest(base, FIXED_NOW)).location).toBeNull();
  });

  it("rejects missing or invalid fields", async () => {
    await expect(createAppointmentRequest({ ...base, phone: "123" }, FIXED_NOW)).rejects.toThrow(ValidationFailure);
    await expect(createAppointmentRequest({ ...base, reason: "" }, FIXED_NOW)).rejects.toThrow(ValidationFailure);
    expect(await listAppointmentRequests()).toHaveLength(0);
  });

  it("supports search, status filter, update and delete", async () => {
    const a = await createAppointmentRequest(base, FIXED_NOW);
    await createAppointmentRequest({ ...base, full_name: "Maria Lopez", reason: "Cleaning" }, FIXED_NOW);
    expect(await listAppointmentRequests({ q: "maria" })).toHaveLength(1);
    expect(await listAppointmentRequests({ q: "invisalign" })).toHaveLength(1);
    expect((await updateAppointmentStatus(a.id, "contacted"))?.status).toBe("contacted");
    expect(await listAppointmentRequests({ status: "contacted" })).toHaveLength(1);
    expect(await listAppointmentRequests({ status: "new" })).toHaveLength(1);
    expect(await deleteAppointmentRequest(a.id)).toBe(true);
    expect(await deleteAppointmentRequest(a.id)).toBe(false);
    expect(await listAppointmentRequests()).toHaveLength(1);
  });

  it("links transcripts to request ids and upserts", async () => {
    const r = await createAppointmentRequest(base, FIXED_NOW);
    const t0 = new Date().toISOString();
    await saveTranscript("s1", t0, [{ role: "patient", text: "hi", at: "x" }], []);
    await saveTranscript("s1", t0, [{ role: "patient", text: "hi", at: "x" }, { role: "receptionist", text: "hello", at: "y" }], [r.id]);
    const t = await getTranscriptForRequest(r.id);
    expect(t).toHaveLength(2);
    expect(await getTranscriptForRequest(9999)).toBeNull();
  });
});
