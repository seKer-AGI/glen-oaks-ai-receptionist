import { describe, expect, it } from "vitest";
import { directAnswer } from "@/lib/directAnswer";
import { FIXED_NOW } from "./helpers";

const d = (f: Parameters<typeof directAnswer>[0], t: string) => directAnswer(f, t, FIXED_NOW)?.args ?? null;

describe("directAnswer (booking fast path)", () => {
  it("extracts plain answers, stripping filler phrases", () => {
    expect(d("full_name", "John Smith.")).toEqual({ full_name: "John Smith" });
    expect(d("full_name", "Um, my name is Sara Ahmed")).toEqual({ full_name: "Sara Ahmed" });
    expect(d("address", "I live at 123 Main Street, Queens")).toEqual({ address: "123 Main Street, Queens" });
    expect(d("phone", "My phone number is 718-555-1234")).toEqual({ phone: "718-555-1234" });
    expect(d("phone", "+92 300 1234567")).toEqual({ phone: "+92 300 1234567" });
    expect(d("preferred_date", "October 10th")).toEqual({ preferred_date: "October 10th" });
    expect(d("reason", "I'd like an Invisalign consultation")).toEqual({ reason: "an Invisalign consultation" });
  });

  it("detects a chosen office only when it is clearly about the visit", () => {
    expect(d("reason", "A cleaning at the Jamaica office")).toEqual({ reason: "A cleaning", location: "Jamaica" });
    expect(d("reason", "Checkup at Glen Oaks")).toEqual({ reason: "Checkup", location: "Glen Oaks" });
    expect(d("reason", "A cleaning")).toEqual({ reason: "A cleaning" });
  });

  it("hands anything unusual to the LLM", () => {
    expect(d("full_name", "Do you accept insurance?")).toBeNull(); // question
    expect(d("full_name", "Actually, my name is Michael")).toBeNull(); // correction
    expect(d("full_name", "okay")).toBeNull(); // not a name
    expect(d("phone", "I don't have one")).toBeNull(); // no digits
    expect(d("preferred_date", "whenever works")).toBeNull(); // unparseable date
    expect(d("address", "queens")).toBeNull(); // too vague for a shortcut
    expect(d("reason", "what are your hours")).toBeNull();
  });
});
