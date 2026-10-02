import { describe, expect, it } from "vitest";
import {
  countWords,
  enforceResponseLength,
  shortenResponse,
  validateResponseLength,
} from "@/lib/responseLength";

const long =
  "Yes we absolutely offer Invisalign here at the practice and our orthodontists would be glad to evaluate you for treatment at either of our two convenient offices.";

describe("validateResponseLength", () => {
  it("accepts short replies", () => {
    expect(validateResponseLength("We have offices in Glen Oaks and Jamaica.").valid).toBe(true);
  });
  it("accepts exactly 20 words and rejects 21", () => {
    const w = (n: number) => Array(n).fill("word").join(" ");
    expect(validateResponseLength(w(20)).valid).toBe(true);
    expect(validateResponseLength(w(21)).valid).toBe(false);
    expect(validateResponseLength(w(21)).wordCount).toBe(21);
  });
  it("rejects empty", () => {
    expect(validateResponseLength("  ").valid).toBe(false);
  });
});

describe("shortenResponse", () => {
  it("keeps whole sentences that fit", () => {
    const out = shortenResponse("Yes, Invisalign is available. " + long);
    expect(out).toBe("Yes, Invisalign is available.");
  });
  it("hard-cuts a single overlong sentence to <= 20 words", () => {
    const out = shortenResponse(long);
    expect(countWords(out)).toBeLessThanOrEqual(20);
    expect(out.endsWith(".")).toBe(true);
  });
});

describe("enforceResponseLength", () => {
  it("returns short replies untouched without calling regenerate", async () => {
    let called = 0;
    const out = await enforceResponseLength("Sure thing.", async () => (called++, "x"));
    expect(out).toBe("Sure thing.");
    expect(called).toBe(0);
  });
  it("uses regenerated reply when it fits", async () => {
    const out = await enforceResponseLength(long, async () => "Yes, Invisalign is available.");
    expect(out).toBe("Yes, Invisalign is available.");
  });
  it("falls back to deterministic shortening if regeneration stays too long or throws", async () => {
    expect(countWords(await enforceResponseLength(long, async () => long))).toBeLessThanOrEqual(20);
    expect(
      countWords(await enforceResponseLength(long, async () => { throw new Error("x"); })),
    ).toBeLessThanOrEqual(20);
  });
});
