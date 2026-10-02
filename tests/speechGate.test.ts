import { describe, expect, it } from "vitest";
import { SpeechGate, sentenceEnd } from "@/lib/speechGate";
import { countWords } from "@/lib/responseLength";

const feed = (gate: SpeechGate, text: string, size = 3) => {
  for (let i = 0; i < text.length; i += size) gate.push(text.slice(i, i + size));
  gate.finish(true);
};

describe("sentenceEnd", () => {
  it("finds sentence ends but not abbreviations or incomplete text", () => {
    expect(sentenceEnd("Yes. We do")).toBe(4);
    expect(sentenceEnd("Dr. Shah is here")).toBe(-1);
    expect(sentenceEnd("We are open")).toBe(-1);
  });
});

describe("SpeechGate", () => {
  it("releases each sentence as soon as it is complete, token by token", () => {
    const out: string[] = [];
    const g = new SpeechGate((s) => out.push(s));
    g.push("Yes, we offer Invis");
    expect(out).toEqual([]);
    g.push("align. Would you like");
    expect(out).toEqual(["Yes, we offer Invisalign."]); // spoken before the 2nd sentence is done
    g.push(" to book?");
    g.finish(true);
    expect(out).toEqual(["Yes, we offer Invisalign.", "Would you like to book?"]);
  });

  it("never lets total spoken words exceed 20", () => {
    const out: string[] = [];
    const g = new SpeechGate((s) => out.push(s));
    feed(g, "We have two offices in Queens, Glen Oaks and Jamaica. Both offices have ample parking and accept most insurance plans. Call us anytime.");
    expect(countWords(g.text)).toBeLessThanOrEqual(20);
    expect(out.join(" ")).toMatch(/^We have two offices in Queens, Glen Oaks and Jamaica\./);
    expect(out.join(" ")).not.toContain("Call us anytime."); // dropped after the first overflow
  });

  it("releases nothing if the very first sentence is over the cap", () => {
    const g = new SpeechGate(() => {});
    feed(g, Array(30).fill("word").join(" ") + ".");
    expect(g.hasSpoken).toBe(false);
  });

  it("flushes a final sentence without a period", () => {
    const g = new SpeechGate(() => {});
    feed(g, "Sure, one moment");
    expect(g.text).toBe("Sure, one moment");
  });

  it("starts speaking at a natural phrase boundary, not on every token", () => {
    const out: string[] = [];
    const g = new SpeechGate((c) => out.push(c));
    // single words are never released alone
    for (const tok of ["Yes", ",", " we", " offer", " Invisalign"]) g.push(tok);
    expect(out).toEqual([]);
    g.push(", and our team can help. Would you like a consultation?");
    // first phrase is released at the comma once >= 6 words are buffered
    expect(out[0]).toBe("Yes, we offer Invisalign, and our team can help.");
    g.finish(true);
    expect(out.join(" ")).toBe("Yes, we offer Invisalign, and our team can help. Would you like a consultation?");
  });

  it("merges a very short sentence into the next phrase", () => {
    const out: string[] = [];
    const g = new SpeechGate((c) => out.push(c));
    g.push("Sure. We offer Invisalign here. ");
    g.finish(true);
    expect(out).toEqual(["Sure. We offer Invisalign here."]);
  });

  it("never duplicates or drops words across chunks", () => {
    const text = "Yes, we offer Invisalign clear aligners, and our orthodontists can evaluate you. Shall I book it?";
    const out: string[] = [];
    const g = new SpeechGate((c) => out.push(c));
    for (let i = 0; i < text.length; i += 2) g.push(text.slice(i, i + 2));
    g.finish(true);
    expect(out.join(" ")).toBe(text);
  });
});
