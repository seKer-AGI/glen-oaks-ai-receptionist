import { describe, expect, it } from "vitest";
import {
  normalizePhone,
  parsePreferredDate,
  validateAppointmentInput,
  validateLocation,
  validateName,
} from "@/lib/validation";
import { FIXED_NOW } from "./helpers";

describe("field validation", () => {
  it("accepts real names, rejects digits", () => {
    expect(validateName("John Smith").ok).toBe(true);
    expect(validateName("María O'Neil-Smith").ok).toBe(true);
    expect(validateName("J0hn").ok).toBe(false);
    expect(validateName("A").ok).toBe(false);
  });

  it("normalizes phone formats and spoken digits", () => {
    expect(normalizePhone("718-555-1234")).toEqual({ ok: true, value: "718-555-1234" });
    expect(normalizePhone("(718) 555 1234")).toEqual({ ok: true, value: "718-555-1234" });
    expect(normalizePhone("1 718 555 1234")).toEqual({ ok: true, value: "718-555-1234" });
    expect(normalizePhone("seven one eight five five five one two three four")).toEqual({
      ok: true,
      value: "718-555-1234",
    });
    expect(normalizePhone("12345").ok).toBe(false);
  });

  it("accepts international and local formats instead of insisting on 10 digits", () => {
    expect(normalizePhone("+92 300 1234567")).toEqual({ ok: true, value: "+923001234567" });
    expect(normalizePhone("0300-1234567")).toEqual({ ok: true, value: "03001234567" });
    expect(normalizePhone("555-1234")).toEqual({ ok: true, value: "5551234" });
    expect(normalizePhone("+1 (718) 555-1234")).toEqual({ ok: true, value: "+17185551234" });
    expect(normalizePhone("call me").ok).toBe(false);
  });

  it("parses dates", () => {
    expect(parsePreferredDate("October 10th", FIXED_NOW)).toEqual({ ok: true, value: "2026-10-10" });
    expect(parsePreferredDate("2026-11-03", FIXED_NOW)).toEqual({ ok: true, value: "2026-11-03" });
    expect(parsePreferredDate("10/15", FIXED_NOW)).toEqual({ ok: true, value: "2026-10-15" });
    expect(parsePreferredDate("tomorrow", FIXED_NOW)).toEqual({ ok: true, value: "2026-10-03" });
    expect(parsePreferredDate("next Monday", FIXED_NOW)).toEqual({ ok: true, value: "2026-10-05" });
    // past month/day without a year rolls to next year
    expect(parsePreferredDate("March 3", FIXED_NOW)).toEqual({ ok: true, value: "2027-03-03" });
  });

  it("rejects impossible or past dates", () => {
    expect(parsePreferredDate("February 31", FIXED_NOW).ok).toBe(false);
    expect(parsePreferredDate("2020-01-01", FIXED_NOW).ok).toBe(false);
    expect(parsePreferredDate("whenever", FIXED_NOW).ok).toBe(false);
    expect(parsePreferredDate("next week", FIXED_NOW)).toEqual({ ok: true, value: "2026-10-09" });
    expect(parsePreferredDate("the 20th", FIXED_NOW)).toEqual({ ok: true, value: "2026-10-20" });
  });

  it("maps location text", () => {
    expect(validateLocation("the Glen Oaks office")).toBe("Glen Oaks");
    expect(validateLocation("Jamaica")).toBe("Jamaica");
    expect(validateLocation("Brooklyn")).toBeNull();
    expect(validateLocation(undefined)).toBeNull();
  });
});

describe("validateAppointmentInput (required fields)", () => {
  const good = {
    full_name: "John Smith",
    address: "123 Main Street, Queens",
    phone: "718-555-1234",
    preferred_date: "October 10th",
    reason: "Invisalign consultation",
  };
  it("accepts a complete request", () => {
    const r = validateAppointmentInput({ ...good, location: "Jamaica" }, FIXED_NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.preferred_date).toBe("2026-10-10");
      expect(r.value.location).toBe("Jamaica");
    }
  });
  it("reports each missing field", () => {
    for (const key of Object.keys(good) as (keyof typeof good)[]) {
      const { [key]: _omit, ...rest } = good;
      const r = validateAppointmentInput(rest, FIXED_NOW);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[key]).toBe("required");
    }
  });
});
